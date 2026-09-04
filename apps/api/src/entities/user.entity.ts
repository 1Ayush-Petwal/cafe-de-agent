import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { UserRole } from './user-role.enum';
import { WALLET_SIGNUP_BALANCE } from './wallet.constants';

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

  /** Issue #21 (PRD area C): fake in-app wallet. Issue #3: stored in paise. */
  @Column({ type: 'int', default: WALLET_SIGNUP_BALANCE })
  walletBalance!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
