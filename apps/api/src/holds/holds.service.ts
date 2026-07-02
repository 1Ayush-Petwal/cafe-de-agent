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

@Injectable()
export class HoldsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(tableId: string, slotId: string): string {
    return `hold:${tableId}:${slotId}`;
  }

  private token(holdId: string, userId: string): string {
    return `${holdId}:${userId}`;
  }

  /** `SET NX EX` — atomically acquires the hold or reports it's already taken. */
  async create(
    userId: string,
    tableId: string,
    slotId: string,
    ttlSeconds: number,
  ): Promise<Hold | null> {
    const holdId = randomUUID();
    const result = await this.redis.set(
      this.key(tableId, slotId),
      this.token(holdId, userId),
      'EX',
      ttlSeconds,
      'NX',
    );
    if (result !== 'OK') {
      return null;
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
