import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Issue #24 (PRD area G): a Partner API key scoped to exactly one café. The
 * raw key is shown to the owner once, at generation time, and never stored —
 * only its SHA-256 hash is persisted (the same lookup-hash pattern
 * `confirmHold`'s Idempotency-Key request hash uses: the key is high-entropy
 * random, not a user-chosen secret, so a fast lookup hash is the right tool,
 * not a slow password hash like bcrypt). `keyPrefix` keeps a few characters
 * of the raw key in the clear purely so the dashboard can list keys the
 * owner can tell apart without ever showing the full key again.
 */
@Entity({ name: 'partner_api_keys' })
export class PartnerApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  cafeId!: string;

  @Index({ unique: true })
  @Column()
  keyHash!: string;

  @Column()
  keyPrefix!: string;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
