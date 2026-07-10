import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WebhookEventType } from './webhook-event-type.enum';
import { WebhookJobStatus } from './webhook-job-status.enum';

/**
 * The Partner API's outbox (issue #24, PRD area G) — a second consumer of
 * the transactional-outbox pattern `notification_jobs` established (issue
 * #6): written in the same transaction as the reservation write/cancel, so
 * a booking event can never be lost even if the process crashes right after
 * commit. Unlike `notification_jobs` (at most one job, ever, per
 * reservation), a single reservation can produce two webhook jobs over its
 * lifetime — created, then later cancelled — so the uniqueness backstop is
 * per (reservationId, eventType) rather than per reservationId.
 */
@Entity({ name: 'webhook_jobs' })
@Index('UQ_webhook_job_reservation_event', ['reservationId', 'eventType'], { unique: true })
export class WebhookJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cafeId!: string;

  @Column()
  reservationId!: string;

  @Column({ type: 'enum', enum: WebhookEventType })
  eventType!: WebhookEventType;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'enum', enum: WebhookJobStatus, default: WebhookJobStatus.PENDING })
  status!: WebhookJobStatus;

  @Column({ default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  /** Backoff: a failed attempt pushes this forward instead of retrying immediately. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
