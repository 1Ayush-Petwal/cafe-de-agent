import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { createTestApp, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken as string;
}

/**
 * Issue #12: Redis-backed token bucket, per IP and per authenticated user,
 * applied globally (RateLimitGuard via APP_GUARD). Each describe block below
 * overrides the relevant env var(s) to a tiny capacity with a near-zero
 * refill rate — so the budget is exhausted deterministically within a
 * handful of requests, with no reliance on real-time waiting — then restores
 * the previous value in afterAll so later test files see the generous
 * production defaults untouched.
 */
describe('Rate limiting (e2e)', () => {
  describe('per-IP token bucket', () => {
    let app: INestApplication;
    let redis: Redis;
    const previousCapacity = process.env.RATE_LIMIT_IP_CAPACITY;
    const previousRefill = process.env.RATE_LIMIT_IP_REFILL_PER_SEC;

    beforeAll(async () => {
      process.env.RATE_LIMIT_IP_CAPACITY = '3';
      process.env.RATE_LIMIT_IP_REFILL_PER_SEC = '0.001';
      app = await createTestApp();
      redis = app.get(REDIS_CLIENT);
    });

    beforeEach(async () => {
      await truncateAll(app);
      await redis.flushdb();
    });

    afterAll(async () => {
      await app.close();
      process.env.RATE_LIMIT_IP_CAPACITY = previousCapacity;
      process.env.RATE_LIMIT_IP_REFILL_PER_SEC = previousRefill;
    });

    it('allows requests within the IP budget and 429s beyond it, with a Retry-After hint', async () => {
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer()).get('/cafes').expect(200);
      }
      const res = await request(app.getHttpServer()).get('/cafes').expect(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('holds across multiple API instances sharing the same Redis bucket', async () => {
      const instanceA = await createTestApp();
      const instanceB = await createTestApp();
      try {
        await request(instanceA.getHttpServer()).get('/cafes').expect(200);
        await request(instanceB.getHttpServer()).get('/cafes').expect(200);
        await request(instanceA.getHttpServer()).get('/cafes').expect(200);
        // The 3-token budget is now exhausted across both instances combined.
        await request(instanceB.getHttpServer()).get('/cafes').expect(429);
      } finally {
        await instanceA.close();
        await instanceB.close();
      }
    });
  });

  describe('per-user token bucket', () => {
    let app: INestApplication;
    let redis: Redis;
    const previousCapacity = process.env.RATE_LIMIT_USER_CAPACITY;
    const previousRefill = process.env.RATE_LIMIT_USER_REFILL_PER_SEC;

    beforeAll(async () => {
      process.env.RATE_LIMIT_USER_CAPACITY = '3';
      process.env.RATE_LIMIT_USER_REFILL_PER_SEC = '0.001';
      app = await createTestApp();
      redis = app.get(REDIS_CLIENT);
    });

    beforeEach(async () => {
      await truncateAll(app);
      await redis.flushdb();
    });

    afterAll(async () => {
      await app.close();
      process.env.RATE_LIMIT_USER_CAPACITY = previousCapacity;
      process.env.RATE_LIMIT_USER_REFILL_PER_SEC = previousRefill;
    });

    it('limits an individual user even though their IP still has budget left', async () => {
      const token = await signup(app, 'alice@example.com');
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .get('/notifications/mine')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }
      await request(app.getHttpServer())
        .get('/notifications/mine')
        .set('Authorization', `Bearer ${token}`)
        .expect(429);
    });

    it('tracks each user independently — a different user still has their own budget', async () => {
      const alice = await signup(app, 'alice@example.com');
      const bob = await signup(app, 'bob@example.com');
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .get('/notifications/mine')
          .set('Authorization', `Bearer ${alice}`)
          .expect(200);
      }
      await request(app.getHttpServer())
        .get('/notifications/mine')
        .set('Authorization', `Bearer ${alice}`)
        .expect(429);

      // Bob's bucket is untouched by Alice exhausting hers.
      await request(app.getHttpServer())
        .get('/notifications/mine')
        .set('Authorization', `Bearer ${bob}`)
        .expect(200);
    });
  });
});
