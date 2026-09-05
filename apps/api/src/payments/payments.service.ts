import { randomUUID } from 'crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { paymentProvider } from '../config/payment-provider';
import { DecisionLogService } from '../decisions/decision-log.service';
import { AgentDecisionStep } from '../entities/agent-decision-step.enum';
import { CafeTable } from '../entities/cafe-table.entity';
import { Payment } from '../entities/payment.entity';
import { Slot } from '../entities/slot.entity';
import { HoldsService } from '../holds/holds.service';
import { MandatesService } from '../mandates/mandates.service';
import { ConfirmHoldDto } from '../reservations/dto/confirm-hold.dto';
import { ReservationsService } from '../reservations/reservations.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { verifyRazorpaySignature } from './razorpay-signature';
import { RazorpayClient } from './razorpay.client';

export interface CreatedOrder {
  orderId: string;
  amountMinor: number;
  currency: string;
  keyId: string;
  notes: Record<string, string>;
}

const CAPTURED_EVENT = 'payment.captured';

/** The slice of Razorpay's webhook payload this handler reads. */
export interface RazorpayWebhookBody {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        amount?: number;
        notes?: Record<string, string>;
      };
    };
  };
}

/** Extracts a human/decision-log-readable reason from whatever `confirmHold` threw. */
function failureReason(err: unknown): string {
  if (err instanceof HttpException) {
    const response = err.getResponse();
    if (typeof response === 'object' && response !== null) {
      const body = response as Record<string, unknown>;
      if (typeof body.reason === 'string') return body.reason;
      if (typeof body.message === 'string') return body.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Unknown confirm failure';
}

/**
 * Issue #8 (PRD area E): order creation (the read-only gate check, then the
 * Razorpay call) and webhook handling (signature verification, then the same
 * `confirmHold` every other caller uses). Neither method holds any
 * server-side session state across the gap between them — everything the
 * webhook needs to complete a booking is either in the signed webhook
 * payload's notes or resolvable from `holdId` alone via `HoldsService`.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(CafeTable) private readonly tables: Repository<CafeTable>,
    @InjectRepository(Slot) private readonly slots: Repository<Slot>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly razorpay: RazorpayClient,
    private readonly mandates: MandatesService,
    private readonly holds: HoldsService,
    private readonly reservations: ReservationsService,
    private readonly decisionLog: DecisionLogService,
  ) {}

  /**
   * Issue #12 (PRD area B) / #26 (PRD area E): an order is created only after
   * an allowing preview — read-only, so a denial leaves no Razorpay order and
   * no mandate mutation. With no mandateId there is nothing to preview
   * (direct booking is unbounded by any mandate), and the order is created
   * unconditionally.
   */
  async createOrder(userId: string, dto: CreateOrderDto): Promise<CreatedOrder> {
    if (paymentProvider() !== 'razorpay') {
      throw new BadRequestException('Razorpay is not the active payment provider');
    }

    const table = await this.tables.findOne({ where: { id: dto.tableId }, relations: { cafe: true } });
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    const slot = await this.slots.findOne({ where: { id: dto.slotId } });
    if (!slot || slot.cafeId !== table.cafeId) {
      throw new NotFoundException('Slot not found for this table');
    }

    if (dto.mandateId) {
      const gate = await this.mandates.previewMandate(userId, dto.mandateId, {
        tableId: dto.tableId,
        slotId: dto.slotId,
      });
      if (gate.verdict === 'DENY') {
        throw new HttpException(
          { message: `Mandate denied: ${gate.reason}`, verdict: 'DENY', reason: gate.reason },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // Issue #29: the last two notes keys are what let the webhook complete a
    // booking with no server-side session state of its own — holdId resolves
    // (tableId, slotId) via HoldsService.resolveHold, and idempotencyKey is
    // the same key the agent's/user's own confirm call reuses, so whichever
    // arrives first wins and the other replays.
    const idempotencyKey = randomUUID();
    const notes: Record<string, string> = {
      mandateId: dto.mandateId ?? '',
      agentId: dto.agentId ?? '',
      userId,
      holdId: dto.holdId,
      idempotencyKey,
    };

    const order = await this.razorpay.createOrder(slot.priceMinor, dto.holdId, notes);
    return {
      orderId: order.id,
      amountMinor: slot.priceMinor,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID ?? 'stub',
      notes,
    };
  }

  /**
   * Issue #27/#28 (PRD area E): signature verified against the raw bytes
   * before anything else runs — a wrong-secret payload never reaches
   * `confirmHold`. A correctly signed `payment.captured` event, redelivered
   * or not, converges on the same idempotency key every other caller of
   * `confirmHold` would use, so the existing claim/replay machinery (issue
   * #11) is what makes redelivery and the webhook-vs-agent race both safe —
   * no new concurrency code here.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    body: RazorpayWebhookBody | undefined,
  ): Promise<{ received: boolean }> {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
    if (!rawBody || !signature || !verifyRazorpaySignature(rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (body?.event !== CAPTURED_EVENT) {
      return { received: true };
    }

    const entity = body.payload?.payment?.entity ?? {};
    const notes = (entity.notes ?? {}) as Record<string, string>;
    const holdId = notes.holdId;
    const idempotencyKey = notes.idempotencyKey;
    if (!holdId || !idempotencyKey) {
      throw new BadRequestException('Webhook payload missing required notes');
    }

    const meta = await this.holds.resolveHold(holdId);
    if (!meta) {
      // Hold metadata already expired (well past HOLD_TTL_SECONDS) — nothing
      // left to complete. Acknowledged rather than retried forever.
      return { received: true };
    }

    const dto: ConfirmHoldDto = {
      holdId,
      tableId: meta.tableId,
      slotId: meta.slotId,
      ...(notes.mandateId ? { mandateId: notes.mandateId } : {}),
    };

    const start = Date.now();
    let reservation: Awaited<ReturnType<ReservationsService['confirmHold']>>;
    try {
      reservation = await this.reservations.confirmHold(meta.userId, dto, idempotencyKey);
    } catch (err) {
      await this.compensate(err, entity, notes, dto, Date.now() - start);
      return { received: true };
    }

    if (entity.id) {
      // Idempotent by construction: a redelivered event lands on the same
      // reservation and the `IS NULL` guard makes the second write a no-op.
      await this.payments
        .createQueryBuilder()
        .update(Payment)
        .set({ razorpayPaymentId: entity.id })
        .where('"reservationId" = :reservationId AND "razorpayPaymentId" IS NULL', { reservationId: reservation.id })
        .execute();
    }

    return { received: true };
  }

  /**
   * Issue #9 (PRD area E): a capture already happened at Razorpay by the
   * time this webhook fires, so a confirm that fails here (a mandate
   * exhausted in the gap, a slot taken in the gap, ...) can't be retried —
   * the hold is already consumed and the failure is the same on any replay.
   * Refund-only, matching `confirmHold`'s own contract that a failed
   * confirm leaves no reservation and no payment row behind.
   *
   * Crash window, disclosed rather than hidden: if the process dies between
   * `confirmHold`'s transaction rolling back (above) and the refund call
   * below completing, the captured payment is stranded with no durable
   * record — the Payment row rolled back with everything else
   * `writeBookingAndCharge` wrote. The upgrade path, deliberately deferred:
   * write the Payment row as `CAPTURED` *before* confirm ever runs, then
   * reclaim stranded `CAPTURED` rows with a background sweeper — the same
   * `SELECT ... FOR UPDATE SKIP LOCKED` pattern
   * `notifications/outbox-worker.service.ts` already uses.
   */
  private async compensate(
    err: unknown,
    entity: { id?: string; amount?: number },
    notes: Record<string, string>,
    dto: ConfirmHoldDto,
    latencyMs: number,
  ): Promise<void> {
    const reason = failureReason(err);

    if (entity.id && entity.amount != null) {
      await this.razorpay.refund(entity.id, entity.amount);
    }

    // The decision log is mandate-scoped (issue #6) — a compensation with no
    // mandate involved (e.g. a slot taken in the gap on a direct order) has
    // nothing to log against, but the refund above still ran.
    if (!notes.mandateId) {
      return;
    }

    const table = await this.tables.findOne({ where: { id: dto.tableId }, relations: { cafe: true } });
    const slot = await this.slots.findOne({ where: { id: dto.slotId } });
    if (!table || !slot) {
      return;
    }

    await this.decisionLog.record(undefined, {
      mandateId: notes.mandateId,
      step: AgentDecisionStep.COMPENSATE,
      verdict: 'DENY',
      denyReason: reason,
      requestedAction: {
        amountMinor: slot.priceMinor,
        locality: table.cafe.area,
        slotTime: slot.slotTime.toISOString(),
      },
      constraintsSnap: await this.mandates.getConstraintsSnapshot(notes.mandateId),
      latencyMs,
      holdId: dto.holdId,
      idempotencyKey: notes.idempotencyKey ?? null,
    });
  }
}
