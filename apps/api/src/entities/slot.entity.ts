import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A slot is a fixed, non-overlapping grid cell for one cafe: a 60-minute
 * window shared by every table at that cafe. `slotTime` is the window start.
 */
@Entity({ name: 'slots' })
@Index(['cafeId', 'slotTime'])
export class Slot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  cafeId!: string;

  @Column({ type: 'timestamptz' })
  slotTime!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
