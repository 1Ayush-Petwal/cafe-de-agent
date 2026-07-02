import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { UserRole } from './user-role.enum';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column()
  email!: string;

  @Column()
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.CUSTOMER })
  role!: UserRole;

  @CreateDateColumn()
  createdAt!: Date;
}
