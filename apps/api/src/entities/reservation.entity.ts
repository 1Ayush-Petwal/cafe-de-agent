import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CafeTable } from './cafe-table.entity';
import { ReservationStatus } from './reservation-status.enum';
import { Slot } from './slot.entity';
import { User } from './user.entity';

/**
 * M1 (issue #3) backstop: a partial unique index scoped to `status = booked`
 * so at most one active reservation can exist per (tableId, slotId), while
 * a cancelled reservation frees the slot for a fresh booking. This stays in
 * the schema permanently regardless of which BookingStrategy is used —
 * pessimistic/optimistic still hit this on their final insert if a bug ever
 * lets two writers slip past the app-level guard.
 */
@Entity({ name: 'reservations' })
@Index('UQ_active_reservation_per_table_slot', ['tableId', 'slotId'], {
  unique: true,
  where: `"status" = 'booked'`,
})
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  tableId!: string;

  @ManyToOne(() => CafeTable, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tableId' })
  table!: CafeTable;

  @Column()
  slotId!: string;

  @ManyToOne(() => Slot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slotId' })
  slot!: Slot;

  @Column({ type: 'enum', enum: ReservationStatus, default: ReservationStatus.BOOKED })
  status!: ReservationStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
