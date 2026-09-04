import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { MandateStatus } from './mandate-status.enum';

/**
 * Issue #4 (PRD area B): a human's signed, bounded grant of authority to an
 * agent. Constraints are frozen at grant time and covered by `signature`;
 * consumption counters live on the same row but outside the signature so
 * spending never invalidates it (see mandates/mandate-signature.ts).
 * `consumedMinor`/`consumedBookings` are only ever incremented by the
 * single conditional UPDATE in `authorizeAndConsume` (issue #5, PRD area B)
 * — never read-then-written.
 */
@Entity({ name: 'mandates' })
export class Mandate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'int' })
  maxPerBookingMinor!: number;

  @Column({ type: 'int' })
  maxTotalMinor!: number;

  @Column({ type: 'int' })
  maxBookings!: number;

  @Column({ type: 'text', array: true })
  allowedLocalities!: string[];

  @Column({ type: 'timestamptz' })
  windowStart!: Date;

  @Column({ type: 'timestamptz' })
  windowEnd!: Date;

  @Column({ type: 'int', default: 0 })
  consumedMinor!: number;

  @Column({ type: 'int', default: 0 })
  consumedBookings!: number;

  @Column({ type: 'enum', enum: MandateStatus, default: MandateStatus.ACTIVE })
  status!: MandateStatus;

  /** Mirrors `windowEnd` at grant time: the mandate itself lapses when its validity window closes. */
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  /** HMAC-SHA256 over the constraints only — see mandates/mandate-signature.ts. Non-repudiation record, never a credential. */
  @Column()
  signature!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
