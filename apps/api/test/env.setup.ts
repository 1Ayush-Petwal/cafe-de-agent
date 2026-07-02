import 'reflect-metadata';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://cafe:cafe@localhost:5432/cafe_de_app_test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
// DB index 1, separate from dev's default DB 0 — lets tests flush freely.
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
process.env.HOLD_TTL_SECONDS = '2';
