import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AgentDecisionStep } from '../entities/agent-decision-step.enum';
import { AgentDecision } from '../entities/agent-decision.entity';
import { Mandate } from '../entities/mandate.entity';

export interface RecordDecisionInput {
  mandateId: string;
  step: AgentDecisionStep;
  verdict: 'ALLOW' | 'DENY';
  denyReason: string | null;
  requestedAction: Record<string, unknown>;
  constraintsSnap: object;
  latencyMs: number;
  holdId?: string | null;
  razorpayOrderId?: string | null;
  paymentId?: string | null;
  idempotencyKey?: string | null;
}

@Injectable()
export class DecisionLogService {
  constructor(
    @InjectRepository(AgentDecision) private readonly decisions: Repository<AgentDecision>,
    @InjectRepository(Mandate) private readonly mandates: Repository<Mandate>,
  ) {}

  /**
   * Issue #6 (PRD area C): pass the caller's open transaction `manager` for a
   * step that must rise or fall with the booking it belongs to (e.g. an
   * ALLOWed AUTHORIZE, or CONFIRM) — the row then rolls back if anything
   * later in that same transaction fails. Omit `manager` for a step with no
   * transaction of its own (a preview) or for a denial discovered only after
   * the booking transaction it doomed has already rolled back — that denial
   * must land on its own connection to survive the rollback it caused.
   */
  async record(manager: EntityManager | undefined, input: RecordDecisionInput): Promise<void> {
    const data: Partial<AgentDecision> = {
      holdId: null,
      razorpayOrderId: null,
      paymentId: null,
      idempotencyKey: null,
      ...input,
    };
    if (manager) {
      await manager.save(AgentDecision, manager.create(AgentDecision, data));
    } else {
      await this.decisions.save(this.decisions.create(data));
    }
  }

  async findTrace(userId: string, mandateId: string): Promise<AgentDecision[]> {
    const mandate = await this.mandates.findOne({ where: { id: mandateId } });
    if (!mandate) throw new NotFoundException('Mandate not found');
    if (mandate.userId !== userId) throw new ForbiddenException('Not your mandate');
    return this.decisions.find({ where: { mandateId }, order: { seq: 'ASC' } });
  }
}
