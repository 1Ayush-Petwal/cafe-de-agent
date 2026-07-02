import 'reflect-metadata';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://cafe:cafe@localhost:5432/cafe_de_app_test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
