import { ArmMetrics, DenialCounts } from './run-arm';

export interface HarnessReport {
  generatedAt: string;
  seed: number;
  intentCount: number;
  arms: {
    baseline: ArmSummary;
    agent: ArmSummary;
  };
  doubleBookings: number;
}

export interface ArmSummary {
  slotFillRate: number;
  grossRevenueMinor: number;
  revenuePerSlotMinor: number;
  mandateDenials: DenialCounts;
  platformDenials: DenialCounts;
  /** PRD §11: "over_refusal_rate — legitimate bookings blocked… mandate denials only." */
  overRefusalRate: number;
  compensations: { ok: number; failed: number };
}

function summarize(metrics: ArmMetrics): ArmSummary {
  return {
    slotFillRate: metrics.totalIntents === 0 ? 0 : metrics.filled / metrics.totalIntents,
    grossRevenueMinor: metrics.grossRevenueMinor,
    revenuePerSlotMinor: metrics.filled === 0 ? 0 : Math.round(metrics.grossRevenueMinor / metrics.filled),
    mandateDenials: metrics.mandateDenials,
    platformDenials: metrics.platformDenials,
    overRefusalRate: metrics.totalIntents === 0 ? 0 : metrics.mandateDenials.total / metrics.totalIntents,
    compensations: metrics.compensations,
  };
}

export function buildReport(
  seed: number,
  intentCount: number,
  baseline: ArmMetrics,
  agent: ArmMetrics,
  doubleBookings: number,
): HarnessReport {
  return {
    generatedAt: new Date().toISOString(),
    seed,
    intentCount,
    arms: {
      baseline: summarize(baseline),
      agent: summarize(agent),
    },
    doubleBookings,
  };
}

function formatDenials(denials: DenialCounts): string {
  if (denials.total === 0) return '0';
  const byReason = Object.entries(denials.byReason)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(', ');
  return `${denials.total} (${byReason})`;
}

function rupees(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`;
}

export function toMarkdown(report: HarnessReport): string {
  const { baseline, agent } = report.arms;
  const lines = [
    '# Evaluation harness — two arms, one demand',
    '',
    `Generated ${report.generatedAt} from a fixed seed (${report.seed}), ${report.intentCount} synthetic ` +
      'buyer intents per arm — one synthetic buyer per intent, both arms facing identical demand ' +
      '(apps/api/scripts/eval-harness.ts).',
    '',
    '| Metric | Baseline (exact-match) | Agent (slot-fill + mandate gate) |',
    '|---|---|---|',
    `| Slot fill rate | ${(baseline.slotFillRate * 100).toFixed(1)}% | ${(agent.slotFillRate * 100).toFixed(1)}% |`,
    `| Gross revenue | ${rupees(baseline.grossRevenueMinor)} | ${rupees(agent.grossRevenueMinor)} |`,
    `| Revenue per filled slot | ${rupees(baseline.revenuePerSlotMinor)} | ${rupees(agent.revenuePerSlotMinor)} |`,
    `| Mandate denials | ${formatDenials(baseline.mandateDenials)} | ${formatDenials(agent.mandateDenials)} |`,
    `| Platform denials | ${formatDenials(baseline.platformDenials)} | ${formatDenials(agent.platformDenials)} |`,
    `| Over-refusal rate (mandate denials only) | ${(baseline.overRefusalRate * 100).toFixed(1)}% | ${(agent.overRefusalRate * 100).toFixed(1)}% |`,
    `| Compensations ok / failed | ${baseline.compensations.ok} / ${baseline.compensations.failed} | ${agent.compensations.ok} / ${agent.compensations.failed} |`,
    '',
    `Double bookings under concurrent retry: **${report.doubleBookings}**.`,
    '',
    '## Reading the numbers',
    '',
    '- Both arms are driven by the exact same fixed-seed intent generator ' +
      '(`scripts/harness/intents.ts`) — the fill-rate and revenue deltas above are attributable to the ' +
      'slot-fill mechanic and the mandate gate, not to different demand.',
    '- The baseline arm never calls the alternatives endpoint and carries no mandate — an unavailable ' +
      'requested slot is simply a lost booking. The agent arm proposes a mandate-screened alternative ' +
      'when the requested slot is unavailable, and every action (order creation) is gated by a mandate.',
    '- **Mandate denials and platform denials are counted separately** — the over-refusal rate above ' +
      'counts mandate denials only, never a pre-existing platform rule (an unavailable slot, a race lost ' +
      'to another booking), per the PRD.',
    '- Compensations are genuine capture-then-deny races (a slot taken in the gap between order creation ' +
      'and webhook delivery), not a mocked failure — ~5% of intents are deliberately raced this way; ' +
      '`compensations.failed` must be zero for the compensation path to be considered proven.',
    '- Razorpay is stubbed at the client boundary only: order creation returns a synthetic id, and every ' +
      'capture is a self-signed `payment.captured` payload posted to the real webhook route — signature ' +
      'verification, `confirmHold`, the mandate consume, the booking write and the outbox are all the ' +
      'same code the demo runs.',
    '',
  ];
  return lines.join('\n');
}
