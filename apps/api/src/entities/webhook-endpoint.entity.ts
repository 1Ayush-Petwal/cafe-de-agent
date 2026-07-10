import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Issue #24 (PRD area G): one registered partner webhook URL per café —
 * re-registering replaces it (owner corrects a typo, rotates their local
 * app's URL, etc.) rather than accumulating stale endpoints.
 */
@Entity({ name: 'webhook_endpoints' })
export class WebhookEndpoint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column()
  cafeId!: string;

  @Column()
  url!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
