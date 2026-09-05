/* eslint-disable no-console */
/**
 * Issue #11 (PRD area G): the batch harness. Runs a fixed-seed set of
 * synthetic buyer intents through the exact-match baseline arm and the
 * agent (slot-fill + mandate-gated) arm, and writes the comparison to
 * docs/eval-harness-report.{json,md}.
 *
 * Requires the same Postgres/Redis used by `npm run test` (docker compose).
 * Run with `npm run harness --workspace=apps/api`.
 */
import 'reflect-metadata';
import { WEBHOOK_SECRET } from '../test/utils/razorpay-webhook';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://cafe:cafe@localhost:5432/cafe_de_app_test';
process.env.JWT_SECRET ??= 'harness-secret';
process.env.JWT_EXPIRES_IN ??= '1h';
process.env.SERVER_SECRET ??= 'harness-server-secret';
process.env.PAYMENT_PROVIDER = 'razorpay';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';
// Must match the secret `capturedPayload`/`signPayload` (test/utils/razorpay-webhook.ts)
// actually sign with — a different value here just makes every self-signed
// webhook fail signature verification before it ever reaches `confirmHold`.
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
// Long enough that 30-odd sequential intents (signup, hold, order, webhook)
// never race a hold's own expiry.
process.env.HOLD_TTL_SECONDS = '120';
process.env.RATE_LIMIT_IP_CAPACITY ??= '5000';

import { Client } from 'pg';
import { createTestApp, truncateAll } from '../test/utils/test-app';
import { runHarness } from './harness/run-harness';
import { toMarkdown } from './harness/report';

const TEST_DB_NAME = 'cafe_de_app_test';
const SEED = 20260905;
const INTENT_COUNT = 30;

async function ensureTestDatabase(): Promise<void> {
  const adminUrl =
    process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://cafe:cafe@localhost:5432/postgres';
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB_NAME]);
  if (rowCount === 0) {
    await client.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  }
  await client.end();
}

async function main(): Promise<void> {
  await ensureTestDatabase();
  const app = await createTestApp();

  let report;
  try {
    await truncateAll(app);
    report = await runHarness(app, { seed: SEED, intentCount: INTENT_COUNT });
  } finally {
    await app.close();
  }

  console.log(JSON.stringify(report, null, 2));

  const fs = await import('fs');
  const path = await import('path');
  const docsDir = path.join(__dirname, '..', '..', '..', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'eval-harness-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(docsDir, 'eval-harness-report.md'), toMarkdown(report));
  console.log(`\nWrote ${path.join(docsDir, 'eval-harness-report.json')}`);
  console.log(`Wrote ${path.join(docsDir, 'eval-harness-report.md')}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
