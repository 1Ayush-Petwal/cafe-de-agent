/**
 * Issue #6 (PRD area C): the five steps a mandate-bound booking passes
 * through. `DISCOVER` (search/availability) is deliberately absent — those
 * steps move no money and would dominate the trace with noise.
 */
export enum AgentDecisionStep {
  PROPOSE = 'propose',
  AUTHORIZE = 'authorize',
  CAPTURE = 'capture',
  CONFIRM = 'confirm',
  COMPENSATE = 'compensate',
}
