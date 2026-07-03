import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LlmTurn } from '../agent/llm/agent-llm.types';
import { AgentWorkflowStatus } from './agent-workflow-status.enum';
import { UserRole } from './user-role.enum';

/**
 * The durable agent workflow (issue #9, Roadmap M5): a persisted row is the
 * whole mechanism for "return immediately, run on the worker" and for
 * `AWAITING_APPROVAL` being a park-and-resume rather than a blocked thread —
 * the worker only ever acts on rows it can claim via `SELECT ... FOR UPDATE
 * SKIP LOCKED` (same pattern as the notification outbox, issue #6), and a
 * row sitting in AWAITING_APPROVAL simply isn't claimable until approval
 * flips it back to PENDING.
 */
@Entity({ name: 'agent_workflows' })
export class AgentWorkflow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  /** Copied from the JWT at submission time so the worker can mint tool-call tokens without a DB lookup. */
  @Column()
  email!: string;

  @Column({ type: 'enum', enum: UserRole })
  role!: UserRole;

  @Column('text')
  request!: string;

  @Column({ type: 'enum', enum: AgentWorkflowStatus, default: AgentWorkflowStatus.PENDING })
  status!: AgentWorkflowStatus;

  /** The full LLM conversation (text, function calls, function responses) — also what the UI renders as chat. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  history!: LlmTurn[];

  /**
   * The tool call parked for approval or input (e.g. `confirm_hold`,
   * `ask_user`). A real API tool is executed once approved; `ask_user` is a
   * pure control-flow signal — the customer's answer is appended straight to
   * `history` and never goes over HTTP.
   */
  @Column({ type: 'jsonb', nullable: true })
  pendingAction!: { name: string; args: Record<string, unknown> } | null;

  @Column({ type: 'uuid', nullable: true })
  reservationId!: string | null;

  /** Per-session guardrail (issue #10): caps how many tables this workflow may hold, so a runaway loop can't spam holds. */
  @Column({ type: 'int', default: 0 })
  holdCount!: number;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
