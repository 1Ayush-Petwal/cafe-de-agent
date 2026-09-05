import 'reflect-metadata';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://cafe:cafe@localhost:5432/cafe_de_app_test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.SERVER_SECRET = 'test-server-secret';
// DB index 1, separate from dev's default DB 0 — lets tests flush freely.
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
process.env.HOLD_TTL_SECONDS = '2';
// Issue #8: fixed so the Razorpay e2e spec can self-sign webhook payloads
// with a known secret. RAZORPAY_KEY_ID/SECRET stay unset, keeping
// RazorpayClient in stub mode for every test.
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
// The IP bucket (RateLimitGuard) is a single Redis key shared by every spec
// file's requests for the whole `test:ci` run, since they all originate from
// the same loopback address — a fixed real-world default (100, refill 20/s)
// leaves no headroom as the suite grows and can 429 an unrelated spec's
// requests depending on scheduling order. rate-limit.e2e-spec.ts overrides
// this per-suite to exercise the limit itself, so raising the shared default
// here doesn't weaken that test.
process.env.RATE_LIMIT_IP_CAPACITY = '5000';
