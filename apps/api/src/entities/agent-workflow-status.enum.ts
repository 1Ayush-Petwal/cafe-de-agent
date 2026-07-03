export enum AgentWorkflowStatus {
  /** Claimable by the worker on its next poll — fresh submission or post-approval/answer resume. */
  PENDING = 'pending',
  /** Parked before a spend step; durable (a DB row, not a held thread) until the user approves. */
  AWAITING_APPROVAL = 'awaiting_approval',
  /** Parked on an ambiguous request; durable until the user answers the agent's clarifying question. */
  AWAITING_INPUT = 'awaiting_input',
  DONE = 'done',
  FAILED = 'failed',
}
