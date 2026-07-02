import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { NotificationJobStatus } from './notification-job-status.enum';

/**
 * The transactional outbox (issue #6): written in the same DB transaction
 * as the reservation + payment insert, so a confirmed booking can never
 * lose its notification even if the process crashes right after commit —
 * the job row is already durable and waiting for a worker to pick it up.
 * `reservationId` is unique so at most one notify job ever exists per
 * booking (nothing here re-enqueues on retry-of-confirm).
 */
@Entity({ name: 'notification_jobs' })
export class NotificationJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  reservationId!: string;

  @Column()
  userId!: string;

  @Column()
  message!: string;

  @Column({ type: 'enum', enum: NotificationJobStatus, default: NotificationJobStatus.PENDING })
  status!: NotificationJobStatus;

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
