import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Token bucket, refilled lazily by elapsed wall-clock time rather than a
 * background timer — the whole bucket state (tokens, last-refill-ms) lives
 * in one Redis hash and the read-refill-write-expire sequence is one EVAL,
 * so concurrent requests against the same key (same user/IP, possibly from
 * different API instances) can't race each other into over-granting tokens.
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerSec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])
if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsedMs = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsedMs * refillPerSec / 1000)

local allowed = 0
local retryAfterMs = 0
if tokens >= 1 then
  allowed = 1
  tokens = tokens - 1
else
  retryAfterMs = math.ceil((1 - tokens) / refillPerSec * 1000)
end

redis.call('HMSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('EXPIRE', key, math.max(1, math.ceil(capacity / refillPerSec) * 2))

return {allowed, retryAfterMs}
`;

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(key: string, capacity: number, refillPerSec: number): Promise<RateLimitResult> {
    const [allowed, retryAfterMs] = (await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      key,
      capacity,
      refillPerSec,
      Date.now(),
    )) as [number, number];
    return { allowed: allowed === 1, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }
}
