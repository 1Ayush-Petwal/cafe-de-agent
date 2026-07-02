import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The delivered, customer-visible record (mock channel: an in-app list).
 * `reservationId` is unique — this is the idempotency guard: at-least-once
 * delivery can run the same job twice (e.g. a crash between a successful
 * deliver() and marking the job done), and the second attempt's insert is
 * a no-op instead of a duplicate notification.
 */
@Entity({ name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  reservationId!: string;

  @Column()
  userId!: string;

  @Column()
  message!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
