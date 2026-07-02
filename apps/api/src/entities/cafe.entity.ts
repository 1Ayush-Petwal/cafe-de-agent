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

  @OneToMany(() => CafeTable, (table) => table.cafe)
  tables!: CafeTable[];

  @CreateDateColumn()
  createdAt!: Date;
}
