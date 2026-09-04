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

  /**
   * Issue #3 (PRD area A): integer paise, frozen at seed/generate time from
   * the café's price band and this slot's hour and day (see
   * pricing/slot-price.ts) — never recomputed at read time, so a quoted
   * price and a charged price can never diverge. The default only backstops
   * slot rows created without going through that helper (test fixtures).
   */
  @Column({ type: 'int', default: 40000 })
  priceMinor!: number;

  /**
   * M1 optimistic-locking strategy: bumped on every booking attempt against
   * this slot (any table), compare-and-swapped so a losing writer sees
   * affected=0 and retries. Coarser than per-(table,slot) — matches the
   * pessimistic strategy's lock granularity for a fair comparison.
   */
  @Column({ type: 'int', default: 0 })
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
