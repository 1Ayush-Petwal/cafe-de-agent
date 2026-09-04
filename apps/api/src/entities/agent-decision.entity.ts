import { Column, CreateDateColumn, Entity, Generated, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AgentDecisionStep } from './agent-decision-step.enum';

/**
 * Issue #6 (PRD area C): one row per gate decision a mandate-bound booking
 * produced — what it asked for and what it got, including refusals.
 * `constraintsSnap` freezes the mandate's constraint and consumption state
 * as it stood at this instant, so a past decision can be replayed against
 * the state that caused it rather than the mandate's current state.
 *
 * `seq` orders rows within a trace. `createdAt` alone can't: AUTHORIZE and
 * CONFIRM are written inside the same DB transaction, where `now()` is
 * frozen for every statement in that transaction, so both would carry an
 * identical timestamp. A plain Postgres sequence always advances on insert
 * regardless of transaction boundaries.
 *
 * `denyReason` stores a `MandateDenyReason` value as plain text rather than
 * importing that enum here — entities in this repo depend only on other
 * entities, never on a feature module.
 */
@Entity({ name: 'agent_decisions' })
export class AgentDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Generated('increment')
  @Column({ type: 'int' })
  seq!: number;

  @Index()
  @Column({ type: 'uuid' })
  mandateId!: string;

  @Column({ type: 'enum', enum: AgentDecisionStep })
  step!: AgentDecisionStep;

  @Column({ type: 'varchar' })
  verdict!: 'ALLOW' | 'DENY';

  @Column({ type: 'text', nullable: true })
  denyReason!: string | null;

  /** What the step asked for — the candidate booking's amount/locality/time. */
  @Column({ type: 'jsonb' })
  requestedAction!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  constraintsSnap!: object;

  @Column({ type: 'int' })
  latencyMs!: number;

  /** The Redis hold token, not a foreign key — holds have no DB row (see HoldsService). */
  @Column({ type: 'text', nullable: true })
  holdId!: string | null;

  /** Area E (Razorpay) hasn't landed yet; populated once orders exist. */
  @Column({ type: 'text', nullable: true })
  razorpayOrderId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  paymentId!: string | null;

  @Column({ type: 'text', nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
