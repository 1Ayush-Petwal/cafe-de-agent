import { INestApplication } from '@nestjs/common';
import { runDoubleBookingProbe } from './concurrency-probe';
import { buildHarnessFixture } from './fixture';
import { generateIntents } from './intents';
import { buildReport, HarnessReport } from './report';
import { runArm } from './run-arm';

export interface RunHarnessOptions {
  seed: number;
  intentCount: number;
}

/**
 * Issue #11 (PRD area G): runs the baseline and agent arms over identical
 * fixed-seed demand and returns the report. Each arm gets its own,
 * independently-built café roster (`buildHarnessFixture` is deterministic
 * given the same seed, so both rosters are structurally identical — same
 * areas, same prices, same hot/cold spread — just different UUIDs) so
 * nothing needs truncating or resetting between arms.
 */
export async function runHarness(app: INestApplication, opts: RunHarnessOptions): Promise<HarnessReport> {
  const intents = generateIntents(opts.seed, opts.intentCount);

  const baselineFixture = await buildHarnessFixture(app, opts.seed, 'Baseline');
  const baseline = await runArm(app, 'baseline', intents, baselineFixture);

  const agentFixture = await buildHarnessFixture(app, opts.seed, 'Agent');
  const agent = await runArm(app, 'agent', intents, agentFixture);

  const probe = await runDoubleBookingProbe(app);

  return buildReport(opts.seed, opts.intentCount, baseline, agent, probe.doubleBookings);
}
