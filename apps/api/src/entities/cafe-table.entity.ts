import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cafe } from './cafe.entity';

@Entity({ name: 'tables' })
export class CafeTable {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  cafeId!: string;

  @ManyToOne(() => Cafe, (cafe) => cafe.tables, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cafeId' })
  cafe!: Cafe;

  @Column()
  label!: string;

  @Column({ type: 'int' })
  capacity!: number;

  @Column({ default: true })
  inService!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
