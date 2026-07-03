export enum AgentWorkflowStatus {
  /** Claimable by the worker on its next poll — fresh submission or post-approval resume. */
  PENDING = 'pending',
  /** Parked before a spend step; durable (a DB row, not a held thread) until the user approves. */
  AWAITING_APPROVAL = 'awaiting_approval',
  DONE = 'done',
  FAILED = 'failed',
}
