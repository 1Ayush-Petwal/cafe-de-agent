import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

export interface Hold {
  holdId: string;
  tableId: string;
  slotId: string;
  expiresAt: Date;
}

/**
 * Compare-and-delete: only removes the key if it still holds the token we
 * think we own. Closes the last-second race (Roadmap M2) where a hold
 * expires and is re-acquired by someone else in the gap between "confirm
 * request arrives" and "we'd otherwise blindly delete the key" — a plain
 * DEL would delete the *new* owner's hold instead of failing.
 */
const RELEASE_IF_MATCH_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Acquire-or-reuse (issue #10): a plain `SET NX` fails whenever the key
 * exists, even if the existing hold is this same user's own — which is
 * exactly what a retried `hold_table` call looks like after an agent worker
 * crash rolls its DB transaction back but leaves the already-created Redis
 * hold in place (issue #6's transactional-outbox pattern only protects the
 * Postgres side; a real Redis side effect from before the crash survives a
 * rollback). Returning the *existing* holdId instead of a conflict makes a
 * retried hold_table idempotent per (user, table, slot) — no duplicate hold,
 * no spurious "already held" failure on resume.
 */
const ACQUIRE_OR_REUSE_SCRIPT = `
local current = redis.call("get", KEYS[1])
if current == false then
  redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[2])
  return {"created"}
end
local sep = string.find(current, ":")
local existingUserId = string.sub(current, sep + 1)
if existingUserId == ARGV[3] then
  local existingHoldId = string.sub(current, 1, sep - 1)
  local ttl = redis.call("ttl", KEYS[1])
  return {"reused", existingHoldId, tostring(ttl)}
end
return {"conflict"}
`;

@Injectable()
export class HoldsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(tableId: string, slotId: string): string {
    return `hold:${tableId}:${slotId}`;
  }

  private token(holdId: string, userId: string): string {
    return `${holdId}:${userId}`;
  }

  /**
   * Atomically acquires the hold, reuses this same user's already-held slot
   * (retry-safe), or reports it's held by someone else.
   */
  async create(
    userId: string,
    tableId: string,
    slotId: string,
    ttlSeconds: number,
  ): Promise<Hold | null> {
    const holdId = randomUUID();
    const [status, existingHoldId, existingTtl] = (await this.redis.eval(
      ACQUIRE_OR_REUSE_SCRIPT,
      1,
      this.key(tableId, slotId),
      this.token(holdId, userId),
      String(ttlSeconds),
      userId,
    )) as [string, string?, string?];

    if (status === 'conflict') {
      return null;
    }
    if (status === 'reused') {
      return {
        holdId: existingHoldId!,
        tableId,
        slotId,
        expiresAt: new Date(Date.now() + Number(existingTtl) * 1000),
      };
    }
    return { holdId, tableId, slotId, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  /** Atomically validates ownership and releases the hold in one step. */
  async consume(userId: string, tableId: string, slotId: string, holdId: string): Promise<boolean> {
    const result = await this.redis.eval(
      RELEASE_IF_MATCH_SCRIPT,
      1,
      this.key(tableId, slotId),
      this.token(holdId, userId),
    );
    return result === 1;
  }

  /** Which of the given (tableId, slotId) pairs are currently held by anyone. */
  async getHeldPairs(tableIds: string[], slotIds: string[]): Promise<Set<string>> {
    if (tableIds.length === 0 || slotIds.length === 0) {
      return new Set();
    }
    const pairs: string[] = [];
    for (const tableId of tableIds) {
      for (const slotId of slotIds) {
        pairs.push(`${tableId}:${slotId}`);
      }
    }
    const values = await this.redis.mget(pairs.map((pair) => `hold:${pair}`));
    const held = new Set<string>();
    values.forEach((value, i) => {
      if (value) {
        held.add(pairs[i]);
      }
    });
    return held;
  }
}
