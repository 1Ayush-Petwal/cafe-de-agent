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

@Entity({ name: 'reservations' })
@Index(['tableId', 'slotId'])
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
