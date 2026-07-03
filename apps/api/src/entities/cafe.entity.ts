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

  /** Nullable: seeded cafés (apps/api/src/seed/seed.ts) have no owner. */
  @Column({ type: 'uuid', nullable: true })
  ownerId!: string | null;

  @OneToMany(() => CafeTable, (table) => table.cafe)
  tables!: CafeTable[];

  @CreateDateColumn()
  createdAt!: Date;
}
