import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Reservation } from './reservation.entity';
import { WALLET_CHARGE_AMOUNT } from './wallet.constants';

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

  @Column({ type: 'int', default: WALLET_CHARGE_AMOUNT })
  amount!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
