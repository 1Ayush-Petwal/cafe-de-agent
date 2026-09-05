import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Reservation } from './reservation.entity';

/**
 * Written only on a successful wallet charge (issue #21) — confirm and
 * direct-book both charge before writing the reservation, so a Payment row's
 * existence is proof a real (fake, wallet) charge backed this booking. One
 * per reservation.
 */
@Entity({ name: 'payments' })
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  reservationId!: string;

  @OneToOne(() => Reservation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reservationId' })
  reservation!: Reservation;

  /** Issue #3 (PRD area A): integer paise, the slot's own priceMinor at the moment it was charged. */
  @Column({ type: 'int' })
  amount!: number;

  /**
   * Issue #8 (PRD area E): written by the Razorpay webhook on a captured
   * payment. Nullable — a wallet-charged booking has none. Unique so two
   * reservations can never claim the same Razorpay payment; not itself the
   * correctness mechanism for "redelivery books once" (the existing
   * `IdempotencyKey` machinery is), it is an audit link the decision log
   * would reference.
   */
  @Column({ type: 'text', nullable: true, unique: true })
  razorpayPaymentId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
