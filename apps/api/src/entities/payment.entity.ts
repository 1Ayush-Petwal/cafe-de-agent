import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Reservation } from './reservation.entity';

/**
 * Written only on a successful mock charge (issue #5) — confirm charges
 * before writing the reservation, so a Payment row's existence is proof a
 * real (mock) charge backed this booking. One per reservation.
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

  @CreateDateColumn()
  createdAt!: Date;
}
