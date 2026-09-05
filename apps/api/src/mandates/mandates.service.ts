import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DecisionLogService } from '../decisions/decision-log.service';
import { AgentDecisionStep } from '../entities/agent-decision-step.enum';
import { CafeTable } from '../entities/cafe-table.entity';
import { MandateStatus } from '../entities/mandate-status.enum';
import { Mandate } from '../entities/mandate.entity';
import { Slot } from '../entities/slot.entity';
import { CreateMandateDto } from './dto/create-mandate.dto';
import { PreviewMandateDto } from './dto/preview-mandate.dto';
import {
  evaluateMandate,
  MandateCheckInput,
  MandateConstraintsSnapshot,
  MandateGateResult,
  snapshotConstraints,
} from './mandate-gate';
import { signMandateConstraints } from './mandate-signature';

/** What a customer sees: the signed grant plus the headroom derived from it. */
export interface MandateView {
  id: string;
  userId: string;
  maxPerBookingMinor: number;
  maxTotalMinor: number;
  maxBookings: number;
  allowedLocalities: string[];
  windowStart: Date;
  windowEnd: Date;
  consumedMinor: number;
  consumedBookings: number;
  remainingMinor: number;
  remainingBookings: number;
  status: MandateStatus;
  expiresAt: Date;
  revokedAt: Date | null;
  signature: string;
  createdAt: Date;
}

function toView(mandate: Mandate): MandateView {
  return {
    id: mandate.id,
    userId: mandate.userId,
    maxPerBookingMinor: mandate.maxPerBookingMinor,
    maxTotalMinor: mandate.maxTotalMinor,
    maxBookings: mandate.maxBookings,
    allowedLocalities: mandate.allowedLocalities,
    windowStart: mandate.windowStart,
    windowEnd: mandate.windowEnd,
    consumedMinor: mandate.consumedMinor,
    consumedBookings: mandate.consumedBookings,
    remainingMinor: Math.max(0, mandate.maxTotalMinor - mandate.consumedMinor),
    remainingBookings: Math.max(0, mandate.maxBookings - mandate.consumedBookings),
    status: mandate.status,
    expiresAt: mandate.expiresAt,
    revokedAt: mandate.revokedAt,
    signature: mandate.signature,
    createdAt: mandate.createdAt,
  };
}

@Injectable()
export class MandatesService {
  constructor(
    @InjectRepository(Mandate) private readonly mandates: Repository<Mandate>,
    @InjectRepository(CafeTable) private readonly tables: Repository<CafeTable>,
    @InjectRepository(Slot) private readonly slots: Repository<Slot>,
    private readonly decisionLog: DecisionLogService,
  ) {}

  async grant(userId: string, dto: CreateMandateDto): Promise<MandateView> {
    const windowStart = new Date(dto.windowStart);
    const windowEnd = new Date(dto.windowEnd);
    if (windowEnd <= windowStart) {
      throw new BadRequestException('windowEnd must be after windowStart');
    }
    if (dto.maxPerBookingMinor > dto.maxTotalMinor) {
      throw new BadRequestException('maxPerBookingMinor cannot exceed maxTotalMinor');
    }

    const signature = signMandateConstraints({
      maxPerBookingMinor: dto.maxPerBookingMinor,
      maxTotalMinor: dto.maxTotalMinor,
      maxBookings: dto.maxBookings,
      allowedLocalities: dto.allowedLocalities,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });

    const mandate = await this.mandates.save(
      this.mandates.create({
        userId,
        maxPerBookingMinor: dto.maxPerBookingMinor,
        maxTotalMinor: dto.maxTotalMinor,
        maxBookings: dto.maxBookings,
        allowedLocalities: dto.allowedLocalities,
        windowStart,
        windowEnd,
        expiresAt: windowEnd,
        signature,
      }),
    );
    return toView(mandate);
  }

  async getStatus(userId: string, mandateId: string): Promise<MandateView> {
    return toView(await this.findOwned(userId, mandateId));
  }

  async revoke(userId: string, mandateId: string): Promise<MandateView> {
    const mandate = await this.findOwned(userId, mandateId);
    if (mandate.status !== MandateStatus.REVOKED) {
      mandate.status = MandateStatus.REVOKED;
      mandate.revokedAt = new Date();
      await this.mandates.save(mandate);
    }
    return toView(mandate);
  }

  /**
   * Issue #5 (PRD area B): the advisory half of the gate. Read-only —
   * resolves the candidate booking's price/locality/time from its
   * table+slot (the same fields the binding check evaluates) and runs them
   * through the same {@link evaluateMandate} logic, but writes nothing. A
   * `DENY` here means no payment intent is ever created; an `ALLOW` here is
   * not a promise — the binding check at confirm re-evaluates atomically
   * and is the actual arbiter.
   */
  async previewMandate(userId: string, mandateId: string, dto: PreviewMandateDto): Promise<MandateGateResult> {
    const start = Date.now();
    const mandate = await this.findOwned(userId, mandateId);
    const table = await this.tables.findOne({ where: { id: dto.tableId }, relations: { cafe: true } });
    if (!table) throw new NotFoundException('Table not found');
    const slot = await this.slots.findOne({ where: { id: dto.slotId } });
    if (!slot || slot.cafeId !== table.cafeId) throw new NotFoundException('Slot not found for this table');

    const input: MandateCheckInput = { amountMinor: slot.priceMinor, locality: table.cafe.area, slotTime: slot.slotTime };
    const result = evaluateMandate(mandate, input);

    // Issue #6 (PRD area C): PROPOSE — a preview has no transaction of its
    // own and mutates nothing, so this is always a standalone insert.
    await this.decisionLog.record(undefined, {
      mandateId,
      step: AgentDecisionStep.PROPOSE,
      verdict: result.verdict,
      denyReason: result.verdict === 'DENY' ? result.reason : null,
      requestedAction: { amountMinor: input.amountMinor, locality: input.locality, slotTime: input.slotTime.toISOString() },
      constraintsSnap: snapshotConstraints(mandate),
      latencyMs: Date.now() - start,
    });

    return result;
  }

  /**
   * Issue #5 (PRD area B): the binding half of the gate. One conditional
   * `UPDATE ... RETURNING` evaluates every ceiling in the same statement
   * that increments the consumption counters — must run inside the
   * caller's transaction (the one that also writes the reservation and
   * payment), so a denial rolls the whole booking back atomically. Zero
   * rows affected is the denial; there is no prior read of the mandate to
   * decide the outcome, only a read *after* a denial, purely to explain it
   * (see {@link evaluateMandate}) — that lookup never feeds back into a
   * write, so it introduces no read-then-write race.
   */
  async authorizeAndConsume(
    manager: EntityManager,
    mandateId: string,
    input: MandateCheckInput,
  ): Promise<MandateGateResult & { snapshot: MandateConstraintsSnapshot }> {
    const result = await manager
      .createQueryBuilder()
      .update(Mandate)
      .set({
        consumedMinor: () => `"consumedMinor" + ${input.amountMinor}`,
        consumedBookings: () => '"consumedBookings" + 1',
      })
      .where(
        `id = :mandateId
         AND status = :status
         AND "expiresAt" > :now
         AND :amountMinor <= "maxPerBookingMinor"
         AND "consumedMinor" + :amountMinor <= "maxTotalMinor"
         AND "consumedBookings" + 1 <= "maxBookings"
         AND :locality = ANY("allowedLocalities")
         AND :slotTime BETWEEN "windowStart" AND "windowEnd"`,
        {
          mandateId,
          status: MandateStatus.ACTIVE,
          now: new Date(),
          amountMinor: input.amountMinor,
          locality: input.locality,
          slotTime: input.slotTime,
        },
      )
      .execute();

    // Issue #6 (PRD area C): re-read regardless of outcome — the ALLOW
    // branch needs the post-consume state as its snapshot, the DENY branch
    // already needed this read to explain the reason.
    const mandate = await manager.findOneOrFail(Mandate, { where: { id: mandateId } });
    const snapshot = snapshotConstraints(mandate);

    if (result.affected === 1) {
      return { verdict: 'ALLOW', snapshot };
    }

    return { ...evaluateMandate(mandate, input), snapshot };
  }

  /** Existence + ownership only — no mutation, so safe to call ahead of a transaction. */
  async assertOwned(userId: string, mandateId: string): Promise<void> {
    await this.findOwned(userId, mandateId);
  }

  /**
   * Issue #9 (PRD area E): the compensate step logs a decision after the
   * booking transaction that would have carried `gate.snapshot` has already
   * rolled back, so there is no snapshot to reuse — this re-reads the
   * mandate's current state for the log row instead. No ownership check:
   * the only caller is the webhook handler, which has no user request to
   * check ownership against.
   */
  async getConstraintsSnapshot(mandateId: string): Promise<MandateConstraintsSnapshot> {
    const mandate = await this.mandates.findOneOrFail({ where: { id: mandateId } });
    return snapshotConstraints(mandate);
  }

  private async findOwned(userId: string, mandateId: string): Promise<Mandate> {
    const mandate = await this.mandates.findOne({ where: { id: mandateId } });
    if (!mandate) throw new NotFoundException('Mandate not found');
    if (mandate.userId !== userId) throw new ForbiddenException('Not your mandate');
    return mandate;
  }
}
