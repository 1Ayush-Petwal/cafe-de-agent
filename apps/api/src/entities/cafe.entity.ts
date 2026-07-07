import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { CafeTable } from './cafe-table.entity';

@Entity({ name: 'cafes' })
export class Cafe {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column()
  area!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  /**
   * Store-locator fields (issue #18 / PRD area D). Coordinates are nullable —
   * owner-created cafés may not have set them yet; Delhi seed cafés get real
   * ones. `region` defaults to 'delhi' (the only region in v1). `cuisines` is
   * a Postgres text array (deliberately no join table for the filter chips).
   * `rating`/`ratingCount` are seeded plausible values; cuisines are
   * owner-editable.
   */
  @Column({ type: 'double precision', nullable: true })
  latitude!: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude!: number | null;

  @Column({ type: 'text', default: 'delhi' })
  region!: string;

  @Column({ type: 'int', default: 9 })
  openingHour!: number;

  @Column({ type: 'int', default: 22 })
  closingHour!: number;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  cuisines!: string[];

  @Column({ type: 'double precision', default: 0 })
  rating!: number;

  @Column({ type: 'int', default: 0 })
  ratingCount!: number;

  /** Nullable: seeded cafés (apps/api/src/seed/seed.ts) have no owner. */
  @Column({ type: 'uuid', nullable: true })
  ownerId!: string | null;

  @OneToMany(() => CafeTable, (table) => table.cafe)
  tables!: CafeTable[];

  @CreateDateColumn()
  createdAt!: Date;
}
