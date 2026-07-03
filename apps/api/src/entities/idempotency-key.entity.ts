import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * M6 (issue #11): the claim/replay record for `Idempotency-Key` on
 * POST /reservations/confirm. Primary key is (userId, key) — keys are
 * scoped per user, not global, so two users can never collide on the same
 * client-generated string. `requestHash` guards against the same key being
 * reused for a materially different request. `responseBody` is null while
 * the original request is still being executed, which is how a genuinely
 * concurrent duplicate (the double-click case) is told apart from "the
 * first attempt already finished."
 */
@Entity({ name: 'idempotency_keys' })
export class IdempotencyKey {
  @PrimaryColumn()
  userId!: string;

  @PrimaryColumn()
  key!: string;

  @Column()
  requestHash!: string;

  @Column({ type: 'int', nullable: true })
  statusCode!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  responseBody!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
