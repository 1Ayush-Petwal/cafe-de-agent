import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

const DEFAULT_TTL_SECONDS = 5;

/**
 * M6 (issue #13): cache-aside for café search/availability reads. The cache
 * is a hint only — CafesService always re-derives from Postgres+Redis-holds
 * on a miss, and the booking write path (hold/confirm) never reads from
 * here at all, so a stale entry can make a free slot look busy for up to
 * the TTL but can never make a taken slot look free (see
 * ReservationsService.hold/executeConfirm, which re-validate against the
 * real hold/reservation state regardless of what's cached).
 */
@Injectable()
export class AvailabilityCacheService {
  private readonly ttlSeconds: number;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.ttlSeconds = Number(process.env.AVAILABILITY_CACHE_TTL_SECONDS) || DEFAULT_TTL_SECONDS;
  }

  private key(cafeId: string, date: string): string {
    return `availability:${cafeId}:${date}`;
  }

  private trackedKey(cafeId: string): string {
    return `availability:tracked:${cafeId}`;
  }

  async get<T>(cafeId: string, date: string): Promise<T | null> {
    const raw = await this.redis.get(this.key(cafeId, date));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  /**
   * Remembers `date` in a per-café tracking set (also TTL'd) so invalidate()
   * can drop every cached date for a café on a booking-state change without
   * a Redis KEYS/SCAN — the event that triggers invalidation only carries
   * cafeId, not date.
   */
  async set(cafeId: string, date: string, payload: unknown): Promise<void> {
    const tracked = this.trackedKey(cafeId);
    await Promise.all([
      this.redis.set(this.key(cafeId, date), JSON.stringify(payload), 'EX', this.ttlSeconds),
      this.redis.sadd(tracked, date),
    ]);
    await this.redis.expire(tracked, this.ttlSeconds);
  }

  async invalidateAvailability(cafeId: string): Promise<void> {
    const tracked = this.trackedKey(cafeId);
    const dates = await this.redis.smembers(tracked);
    if (dates.length === 0) {
      return;
    }
    await this.redis.del(tracked, ...dates.map((date) => this.key(cafeId, date)));
  }

  async getCafeList<T>(): Promise<T | null> {
    const raw = await this.redis.get('cafes:list');
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setCafeList(payload: unknown): Promise<void> {
    await this.redis.set('cafes:list', JSON.stringify(payload), 'EX', this.ttlSeconds);
  }
}
