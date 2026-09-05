import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { runDoubleBookingProbe } from '../scripts/harness/concurrency-probe';
import { generateIntents } from '../scripts/harness/intents';
import { toMarkdown } from '../scripts/harness/report';
import { runHarness } from '../scripts/harness/run-harness';
import { createTestApp, truncateAll } from './utils/test-app';

// ReservationsService reads HOLD_TTL_SECONDS in its constructor — must be
// set before createTestApp() compiles the module. env.setup.ts's '2' is
// right for every other spec's fast expiry test, but too short for a batch
// of sequential intents (signup, hold, order, webhook) per buyer.
process.env.HOLD_TTL_SECONDS = '120';

// A 24-intent-per-arm batch is dozens of sequential HTTP round trips plus a
// bcrypt hash per signup — comfortably over the suite's default 30s.
jest.setTimeout(180000);

const SEED = 424242;
const INTENT_COUNT = 24;

/**
 * Issue #11 (PRD area G): the evaluation harness. `npm run harness` (a
 * standalone script, scripts/eval-harness.ts) produces the same report for
 * a README-sized run; this spec runs the identical `runHarness` against a
 * smaller batch so CI enforces its two safety claims — clean compensation
 * and zero double bookings under concurrent retry — as real assertions,
 * not printed numbers nobody checked.
 */
describe('Evaluation harness: two arms, one demand (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    process.env.PAYMENT_PROVIDER = 'razorpay';
    await truncateAll(app);
  });

  afterAll(async () => {
    // Restored, not deleted: a deleted key is refilled from apps/api/.env by
    // the next spec's ConfigModule boot (see test/env.setup.ts).
    process.env.PAYMENT_PROVIDER = 'wallet';
    await app.close();
  });

  it('produces identical intents from the same seed on every call', () => {
    const first = generateIntents(SEED, INTENT_COUNT);
    const second = generateIntents(SEED, INTENT_COUNT);
    expect(second).toEqual(first);
    expect(first).toHaveLength(INTENT_COUNT);
  });

  it('runs both arms over identical demand, compensates every injected failure cleanly, and writes JSON + Markdown', async () => {
    const report = await runHarness(app, { seed: SEED, intentCount: INTENT_COUNT });

    expect(report.arms.baseline.compensations.failed).toBe(0);
    expect(report.arms.agent.compensations.failed).toBe(0);

    // Baseline never sees a mandate at all — every denial it hits is platform-level.
    expect(report.arms.baseline.mandateDenials.total).toBe(0);
    expect(report.arms.baseline.overRefusalRate).toBe(0);

    // The agent arm's mandates are deliberately too narrow for some intents
    // (see scripts/harness/intents.ts) — the gate must actually fire under load.
    expect(report.arms.agent.mandateDenials.total).toBeGreaterThan(0);

    // Mandate and platform denials are reported as separate buckets, per the
    // PRD — neither reason vocabulary leaks into the other's bucket.
    const platformReasons = ['slot_unavailable', 'confirm_failed_unexpectedly'];
    const mandateReasons = [
      'locality_mismatch',
      'per_booking_ceiling_exceeded',
      'total_ceiling_exceeded',
      'window_mismatch',
      'bookings_exhausted',
      'expired',
      'revoked',
    ];
    expect(Object.keys(report.arms.agent.mandateDenials.byReason).every((r) => mandateReasons.includes(r))).toBe(true);
    expect(Object.keys(report.arms.agent.platformDenials.byReason).every((r) => platformReasons.includes(r))).toBe(
      true,
    );

    // Writing JSON + Markdown is asserted here against a scratch directory,
    // not the repo's tracked docs/ — the canonical report there comes from
    // `npm run harness` (scripts/eval-harness.ts) alone, so a CI run of this
    // spec never rewrites a tracked file with its own smaller batch.
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-harness-'));
    fs.writeFileSync(path.join(scratchDir, 'eval-harness-report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(scratchDir, 'eval-harness-report.md'), toMarkdown(report));
    expect(fs.existsSync(path.join(scratchDir, 'eval-harness-report.json'))).toBe(true);
    expect(fs.existsSync(path.join(scratchDir, 'eval-harness-report.md'))).toBe(true);
  });

  it('books exactly once under N concurrent redeliveries of the same captured event', async () => {
    const result = await runDoubleBookingProbe(app, 10);
    expect(result.bookings).toBe(1);
    expect(result.doubleBookings).toBe(0);
  });
});
