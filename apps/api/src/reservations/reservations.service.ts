import { createHash } from 'crypto';
import {
  ConflictException,
  GoneException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { DecisionLogService } from '../decisions/decision-log.service';
import { AgentDecisionStep } from '../entities/agent-decision-step.enum';
import { CafeTable } from '../entities/cafe-table.entity';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { NotificationJob } from '../entities/notification-job.entity';
import { Payment } from '../entities/payment.entity';
import { ReservationStatus } from '../entities/reservation-status.enum';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { User } from '../entities/user.entity';
import { WebhookEventType } from '../entities/webhook-event-type.enum';
import { WebhookJob } from '../entities/webhook-job.entity';
import { Hold, HoldsService } from '../holds/holds.service';
import { MandateDenyReason } from '../mandates/mandate-deny-reason.enum';
import { MandatesService } from '../mandates/mandates.service';
import { AvailabilityEventsService } from '../realtime/availability-events.service';
import { BookingStrategy } from './booking-strategy.enum';
import { ConfirmHoldDto } from './dto/confirm-hold.dto';
import { CreateHoldDto } from './dto/create-hold.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';

const TAKEN_MESSAGE = 'This table is already booked for that slot';
const UNIQUE_VIOLATION = '23505';
const OPTIMISTIC_MAX_ATTEMPTS = 10;
const DEFAULT_HOLD_TTL_SECONDS = 90;
/** Issue #17 (PRD area B): one active reservation per user per café within any rolling 10-hour window. */
const BOOKING_WINDOW_MS = 10 * 60 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === UNIQUE_VIOLATION;
}

/** Thrown by {@link ReservationsService.chargeWallet} when the conditional decrement affects zero rows. */
class InsufficientBalanceError extends Error {}

/** Thrown when {@link MandatesService.authorizeAndConsume} returns a DENY inside the confirm transaction. */
class MandateDeniedError extends Error {
  constructor(readonly reason: MandateDenyReason) {
    super(`Mandate denied: ${reason}`);
  }
}

@Injectable()
export class ReservationsService {
  private readonly holdTtlSeconds: number;

  constructor(
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    @InjectRepository(CafeTable) private readonly tables: Repository<CafeTable>,
    @InjectRepository(Slot) private readonly slots: Repository<Slot>,
    @InjectRepository(IdempotencyKey) private readonly idempotencyKeys: Repository<IdempotencyKey>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly holds: HoldsService,
    private readonly events: AvailabilityEventsService,
    private readonly mandates: MandatesService,
    private readonly decisionLog: DecisionLogService,
  ) {
    this.holdTtlSeconds = Number(process.env.HOLD_TTL_SECONDS) || DEFAULT_HOLD_TTL_SECONDS;
  }

  /**
   * Issue #21 (PRD area C): the fake in-app wallet is the payment gateway.
   * A single conditional UPDATE only decrements rows where the balance is
   * already ≥ the charge — success or failure is read straight off the
   * affected-row count, so this is safe under concurrent charges against the
   * same user without a separate SELECT-then-check race. Must run inside the
   * same transaction as the reservation/payment write (see call sites) so a
   * charge can never survive a booking that didn't.
   *
   * Issue #3 (PRD area A): `amountMinor` is the slot's own frozen price in
   * paise — there is no longer a single flat charge amount.
   */
  private async chargeWallet(manager: EntityManager, userId: string, amountMinor: number): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(User)
      .set({ walletBalance: () => `"walletBalance" - ${amountMinor}` })
      .where('id = :userId AND "walletBalance" >= :amount', { userId, amount: amountMinor })
      .execute();
    if (result.affected !== 1) {
      throw new InsufficientBalanceError();
    }
  }

  private async refundWallet(manager: EntityManager, userId: string, amountMinor: number): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(User)
      .set({ walletBalance: () => `"walletBalance" + ${amountMinor}` })
      .where('id = :userId', { userId })
      .execute();
  }

  /**
   * Reads the balance fresh — called after a `chargeWallet` rollback, so
   * this is the pre-charge balance. Issue #3: the wallet itself is paise;
   * this is the one place paise become rupees, since the message is for a
   * human to read.
   */
  private async insufficientBalanceMessage(userId: string): Promise<string> {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    return `Payment failed — insufficient wallet balance (₹${Math.floor(user.walletBalance / 100)} remaining)`;
  }

  /** Translates the two failure modes shared by every write path: no money, or someone else won the race. */
  private async translateBookingError(err: unknown, userId: string): Promise<never> {
    if (err instanceof InsufficientBalanceError) {
      throw new HttpException(await this.insufficientBalanceMessage(userId), HttpStatus.PAYMENT_REQUIRED);
    }
    if (isUniqueViolation(err)) {
      throw new ConflictException(TAKEN_MESSAGE);
    }
    throw err;
  }

  /**
   * Partner API outbox (issue #24, PRD area G): a second consumer of the
   * same transactional-outbox pattern `notification_jobs` established
   * (issue #6) — written in the same transaction as the reservation write
   * or cancel, so a booking event can never be lost even if the process
   * crashes right after commit. A dedicated worker (WebhookWorkerService)
   * drains this queue independently, so a partner's downtime never slows or
   * fails a booking. `reservation` is a plain (tableId, slotId) reference —
   * the table/slot lookups run against the transaction's own manager so a
   * cancel enqueued alongside a status flip sees the same snapshot.
   */
  private async enqueueWebhookJob(
    manager: EntityManager,
    eventType: WebhookEventType,
    reservation: Pick<Reservation, 'id' | 'tableId' | 'slotId'>,
  ): Promise<void> {
    const table = await manager.findOneOrFail(CafeTable, { where: { id: reservation.tableId } });
    const slot = await manager.findOneOrFail(Slot, { where: { id: reservation.slotId } });
    await manager.save(
      WebhookJob,
      manager.create(WebhookJob, {
        cafeId: table.cafeId,
        reservationId: reservation.id,
        eventType,
        payload: {
          event: eventType,
          reservationId: reservation.id,
          cafeId: table.cafeId,
          tableId: reservation.tableId,
          slotId: reservation.slotId,
          slotTime: slot.slotTime.toISOString(),
        },
      }),
    );
  }

  /**
   * Charges the wallet and writes the reservation + payment atomically
   * (within the caller's transaction) — shared by every write path (direct
   * book's three strategies and hold->confirm) so the charge and the
   * Payment record it produces can never diverge between them. Issue #3
   * (PRD area A): the charge is the slot's own frozen `priceMinor`, resolved
   * here — the single seam every write path already routes through — rather
   * than a flat constant, so direct-book and hold->confirm charge
   * identically by construction. Every path that lands a reservation in
   * `booked` also enqueues the partner `booking.created` webhook here, so
   * direct book can't become a free side door around partner sync the way
   * it once was around the wallet charge.
   */
  private async writeBookingAndCharge(
    manager: EntityManager,
    userId: string,
    dto: { tableId: string; slotId: string },
  ): Promise<Reservation> {
    const slot = await manager.findOneOrFail(Slot, { where: { id: dto.slotId } });
    await this.chargeWallet(manager, userId, slot.priceMinor);
    const saved = await manager.save(
      Reservation,
      manager.create(Reservation, {
        userId,
        tableId: dto.tableId,
        slotId: dto.slotId,
        status: ReservationStatus.BOOKED,
      }),
    );
    await manager.save(Payment, manager.create(Payment, { reservationId: saved.id, amount: slot.priceMinor }));
    await this.enqueueWebhookJob(manager, WebhookEventType.BOOKING_CREATED, saved);
    return saved;
  }

  /**
   * Direct-book strategies that own no transaction of their own (unique, and
   * optimistic after it wins the CAS): run {@link writeBookingAndCharge} in a
   * fresh transaction and translate the shared charge/conflict failures.
   * `bookPessimistic` can't share this — it drives its own queryRunner.
   */
  private async bookInTransaction(userId: string, dto: CreateReservationDto): Promise<Reservation> {
    try {
      return await this.dataSource.transaction((manager) => this.writeBookingAndCharge(manager, userId, dto));
    } catch (err) {
      return this.translateBookingError(err, userId);
    }
  }

  /**
   * Issue #17 (PRD area B): a user may hold only one active reservation per
   * café within any rolling 10-hour window. Rejects if the user already has a
   * `booked` reservation at this café whose slot time is strictly within 10
   * hours of the requested slot time (so bookings exactly 10h apart are
   * allowed). Cancelled reservations never count; different cafés are fully
   * independent since the query is scoped to one `cafeId`. Enforced here once
   * and applied at every write entry point — direct book, hold (fail fast),
   * and confirm (authoritative) — so the AI agent inherits it for free by
   * going through the same service.
   *
   * The booking being attempted must not count against itself: the reservation
   * for this exact (table, slot) is excluded. Without it, the authoritative
   * confirm-time check would see the reservation a *successful* confirm just
   * wrote and reject a legitimate retry of that same hold with a 409 window
   * error instead of the correct 410 Gone (single-use hold). Excluding by the
   * full (table, slot) identity — not just the slot — keeps a genuine conflict
   * at the same slot on a *different* table (e.g. a hold taken before a
   * conflicting booking appeared) correctly rejected.
   */
  private async assertWithinWindowFree(userId: string, tableId: string, slot: Slot): Promise<void> {
    const windowStart = new Date(slot.slotTime.getTime() - BOOKING_WINDOW_MS);
    const windowEnd = new Date(slot.slotTime.getTime() + BOOKING_WINDOW_MS);
    const conflict = await this.reservations
      .createQueryBuilder('r')
      .innerJoin(Slot, 's', 's.id = r."slotId"')
      .where('r."userId" = :userId', { userId })
      .andWhere('r.status = :status', { status: ReservationStatus.BOOKED })
      .andWhere('s."cafeId" = :cafeId', { cafeId: slot.cafeId })
      .andWhere('s."slotTime" > :windowStart', { windowStart })
      .andWhere('s."slotTime" < :windowEnd', { windowEnd })
      .andWhere('NOT (r."tableId" = :selfTable AND r."slotId" = :selfSlot)', {
        selfTable: tableId,
        selfSlot: slot.id,
      })
      .select('s."slotTime"', 'slotTime')
      .getRawOne<{ slotTime: Date }>();

    if (conflict) {
      const existingTime = new Date(conflict.slotTime).toISOString();
      throw new ConflictException(
        `You already have a reservation at this café at ${existingTime}. Only one booking per café is allowed within a 10-hour window — cancel that one first.`,
      );
    }
  }

  /**
   * M1 (issue #3): check-and-reserve is now atomic. Three switchable
   * strategies close the M0 TOCTOU race (naive check-then-insert let
   * concurrent requests both pass the "is it free?" check and both insert).
   * `unique` is the default; the partial unique index on the reservations
   * table (see entity) is also a permanent backstop under the other two.
   */
  async book(userId: string, dto: CreateReservationDto): Promise<Reservation> {
    const table = await this.tables.findOne({ where: { id: dto.tableId } });
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    const slot = await this.slots.findOne({ where: { id: dto.slotId } });
    if (!slot || slot.cafeId !== table.cafeId) {
      throw new NotFoundException('Slot not found for this table');
    }

    await this.assertWithinWindowFree(userId, dto.tableId, slot);

    switch (dto.strategy) {
      case BookingStrategy.PESSIMISTIC:
        return this.bookPessimistic(userId, dto);
      case BookingStrategy.OPTIMISTIC:
        return this.bookOptimistic(userId, dto);
      case BookingStrategy.UNIQUE:
      default:
        return this.bookUnique(userId, dto);
    }
  }

  /** Unique constraint: insert optimistically, let Postgres reject the loser. */
  private async bookUnique(userId: string, dto: CreateReservationDto): Promise<Reservation> {
    return this.bookInTransaction(userId, dto);
  }

  /**
   * Pessimistic: `SELECT ... FOR UPDATE` on the slot row serializes every
   * request against this slot (across all tables at that time — coarser
   * than per-table, the tradeoff for a simple, always-correct lock target
   * that's guaranteed to exist before any booking happens).
   */
  private async bookPessimistic(userId: string, dto: CreateReservationDto): Promise<Reservation> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.manager.query('SELECT id FROM slots WHERE id = $1 FOR UPDATE', [dto.slotId]);

      const existing = await queryRunner.manager.findOne(Reservation, {
        where: { tableId: dto.tableId, slotId: dto.slotId, status: ReservationStatus.BOOKED },
      });
      if (existing) {
        throw new ConflictException(TAKEN_MESSAGE);
      }

      const saved = await this.writeBookingAndCharge(queryRunner.manager, userId, dto);
      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      return this.translateBookingError(err, userId);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Optimistic: both requests proceed, but the compare-and-swap on the
   * slot's `version` only lets one writer through per version — the loser
   * sees affected=0 and retries, re-checking whether the slot is now
   * actually taken (vs. a version bump from an unrelated table's booking).
   */
  private async bookOptimistic(userId: string, dto: CreateReservationDto): Promise<Reservation> {
    for (let attempt = 0; attempt < OPTIMISTIC_MAX_ATTEMPTS; attempt++) {
      const slot = await this.slots.findOneOrFail({ where: { id: dto.slotId } });

      const existing = await this.reservations.findOne({
        where: { tableId: dto.tableId, slotId: dto.slotId, status: ReservationStatus.BOOKED },
      });
      if (existing) {
        throw new ConflictException(TAKEN_MESSAGE);
      }

      const updateResult = await this.slots
        .createQueryBuilder()
        .update(Slot)
        .set({ version: () => '"version" + 1' })
        .where('id = :id AND version = :version', { id: slot.id, version: slot.version })
        .execute();

      if (updateResult.affected !== 1) {
        continue; // lost the CAS race — retry from a fresh read
      }

      return this.bookInTransaction(userId, dto);
    }
    throw new ConflictException(TAKEN_MESSAGE);
  }

  /**
   * M2 (issue #4): starting checkout takes a Redis `SET NX EX` hold instead
   * of a long DB transaction — it survives across the HTTP requests a real
   * checkout spans and auto-releases if the customer abandons it.
   */
  async hold(userId: string, dto: CreateHoldDto): Promise<Hold> {
    const table = await this.tables.findOne({ where: { id: dto.tableId } });
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    const slot = await this.slots.findOne({ where: { id: dto.slotId } });
    if (!slot || slot.cafeId !== table.cafeId) {
      throw new NotFoundException('Slot not found for this table');
    }

    const existing = await this.reservations.findOne({
      where: { tableId: dto.tableId, slotId: dto.slotId, status: ReservationStatus.BOOKED },
    });
    if (existing) {
      throw new ConflictException(TAKEN_MESSAGE);
    }

    // Fail fast before taking the Redis hold — no point walking a customer
    // through checkout for a booking the 10-hour window rule can never allow.
    await this.assertWithinWindowFree(userId, dto.tableId, slot);

    const hold = await this.holds.create(userId, dto.tableId, dto.slotId, this.holdTtlSeconds);
    if (!hold) {
      throw new ConflictException('This table is already held for that slot');
    }
    await this.events.publish({ type: 'held', cafeId: table.cafeId, tableId: dto.tableId, slotId: dto.slotId });
    return hold;
  }

  /**
   * M6 (issue #11): with an `Idempotency-Key`, the first request to claim
   * the key executes for real and stores its outcome; every later request
   * with the same (userId, key) replays that stored outcome instead of
   * re-consuming the hold or re-charging — the double-click / retried-agent-
   * tool-call case. Without a key, confirm behaves exactly as before (no
   * regression for callers that don't send one).
   *
   * Claiming is a plain `INSERT ... ON CONFLICT DO NOTHING`: the loser of a
   * genuine race (two requests with the same key landing at once) gets
   * `identifiers.length === 0` and, since the winner hasn't finished yet,
   * finds a row with `responseBody` still null — reported as 409 rather
   * than executed a second time. A key reused for a *different* request
   * (different tableId/slotId/holdId) is rejected outright rather than
   * silently replaying the wrong reservation. See docs/idempotency-keys.md
   * for the keying/retention contract.
   */
  async confirmHold(userId: string, dto: ConfirmHoldDto, idempotencyKey?: string): Promise<Reservation> {
    if (!idempotencyKey) {
      return this.executeConfirm(userId, dto, idempotencyKey);
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ tableId: dto.tableId, slotId: dto.slotId, holdId: dto.holdId }))
      .digest('hex');

    // IdempotencyKey has no generated columns, so TypeORM can't populate
    // `identifiers` from a RETURNING round-trip the way it does for
    // generated PKs — it just echoes back the values we supplied, which
    // would report success even when `ON CONFLICT DO NOTHING` silently
    // skipped the insert. An explicit `.returning()` forces a real
    // RETURNING clause, so `claim.raw` reflects whether a row actually
    // landed: empty means someone else already claimed this key.
    const claim = await this.idempotencyKeys
      .createQueryBuilder()
      .insert()
      .values({ userId, key: idempotencyKey, requestHash, statusCode: null, responseBody: null })
      .orIgnore()
      .returning(['userId', 'key'])
      .execute();

    if ((claim.raw as unknown[]).length === 0) {
      const existing = await this.idempotencyKeys.findOneOrFail({ where: { userId, key: idempotencyKey } });
      if (existing.requestHash !== requestHash) {
        throw new ConflictException('This Idempotency-Key was already used for a different request');
      }
      return this.replay(existing);
    }

    try {
      const reservation = await this.executeConfirm(userId, dto, idempotencyKey);
      await this.idempotencyKeys.update(
        { userId, key: idempotencyKey },
        { statusCode: HttpStatus.CREATED, responseBody: { ...reservation } },
      );
      return reservation;
    } catch (err) {
      if (err instanceof HttpException) {
        await this.idempotencyKeys.update(
          { userId, key: idempotencyKey },
          { statusCode: err.getStatus(), responseBody: { message: err.message } },
        );
      } else {
        // Nothing finished — don't poison the key with a transient failure;
        // let a genuine retry re-execute from scratch.
        await this.idempotencyKeys.delete({ userId, key: idempotencyKey });
      }
      throw err;
    }
  }

  private replay(existing: IdempotencyKey): Reservation {
    if (existing.responseBody === null) {
      throw new ConflictException('This request is already being processed — please retry shortly');
    }
    if (existing.statusCode === HttpStatus.CREATED) {
      return existing.responseBody as unknown as Reservation;
    }
    const message = (existing.responseBody as { message?: string }).message ?? 'Request failed';
    throw new HttpException(message, existing.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Confirm re-validates hold ownership atomically (check-and-delete via a
   * Lua script) before writing to Postgres — the nasty last-second-expiry
   * race the Roadmap calls out: if the hold expired and someone else
   * re-held the slot in the gap, the token no longer matches and this
   * fails cleanly instead of confirming a slot we no longer own.
   *
   * The wallet charge (issue #21) runs inside the same transaction as the
   * reservation/payment write, after the hold is consumed: the hold key is
   * already gone by the time the charge is attempted, so an insufficient
   * balance needs no separate "release the hold" step — the slot is already
   * free — and simply leaves no reservation or payment row behind (the whole
   * transaction rolls back).
   *
   * Issue #5 (PRD area B): when `dto.mandateId` is set, the same transaction
   * also runs `authorizeAndConsume` — the binding half of the gate — right
   * beside the wallet charge, which is already exactly this shape. A `DENY`
   * throws and rolls back the whole transaction, so a denied confirm leaves
   * no reservation, no payment and no consumption, identically to an
   * insufficient balance.
   */
  private async executeConfirm(userId: string, dto: ConfirmHoldDto, idempotencyKey?: string): Promise<Reservation> {
    // Authoritative re-check of the 10-hour window (issue #17): the hold may
    // have been taken before a conflicting booking at this café existed, so
    // re-validate here alongside the write rather than trusting the hold-time
    // check. Run before consuming the hold so a rejected confirm leaves the
    // hold intact for a legitimate retry after cancelling the conflict.
    const slot = await this.slots.findOneOrFail({ where: { id: dto.slotId } });
    await this.assertWithinWindowFree(userId, dto.tableId, slot);

    const table = await this.tables.findOneOrFail({ where: { id: dto.tableId }, relations: { cafe: true } });
    if (dto.mandateId) {
      // Existence + ownership only — no mutation, so safe ahead of the hold
      // consume and the transaction; the atomic UPDATE below is still the
      // sole arbiter of the ceilings themselves.
      await this.mandates.assertOwned(userId, dto.mandateId);
    }

    const consumed = await this.holds.consume(userId, dto.tableId, dto.slotId, dto.holdId);
    if (!consumed) {
      throw new GoneException('Your hold expired or was already used — please try again');
    }

    let reservation: Reservation;
    try {
      reservation = await this.dataSource.transaction(async (manager) => {
        const saved = await this.writeBookingAndCharge(manager, userId, dto);

        if (dto.mandateId) {
          const requestedAction = {
            amountMinor: slot.priceMinor,
            locality: table.cafe.area,
            slotTime: slot.slotTime.toISOString(),
          };
          const authorizeStart = Date.now();
          const gate = await this.mandates.authorizeAndConsume(manager, dto.mandateId, {
            amountMinor: slot.priceMinor,
            locality: table.cafe.area,
            slotTime: slot.slotTime,
          });
          const authorizeLatencyMs = Date.now() - authorizeStart;

          if (gate.verdict === 'DENY') {
            // Issue #6 (PRD area C): standalone, not `manager` — throwing
            // below rolls back everything this transaction wrote, including
            // the reservation and charge `writeBookingAndCharge` just made.
            // The denial itself must survive that rollback, so it is
            // recorded on its own connection rather than inside the doomed
            // transaction.
            await this.decisionLog.record(undefined, {
              mandateId: dto.mandateId,
              step: AgentDecisionStep.AUTHORIZE,
              verdict: 'DENY',
              denyReason: gate.reason,
              requestedAction,
              constraintsSnap: gate.snapshot,
              latencyMs: authorizeLatencyMs,
              holdId: dto.holdId,
              idempotencyKey: idempotencyKey ?? null,
            });
            throw new MandateDeniedError(gate.reason);
          }

          const payment = await manager.findOneOrFail(Payment, { where: { reservationId: saved.id } });
          const decisionFields = {
            mandateId: dto.mandateId,
            verdict: 'ALLOW' as const,
            denyReason: null,
            requestedAction,
            constraintsSnap: gate.snapshot,
            holdId: dto.holdId,
            paymentId: payment.id,
            idempotencyKey: idempotencyKey ?? null,
          };
          // Both rows ride inside `manager`'s transaction: if anything below
          // still fails, they roll back with the booking they describe.
          await this.decisionLog.record(manager, {
            ...decisionFields,
            step: AgentDecisionStep.AUTHORIZE,
            latencyMs: authorizeLatencyMs,
          });
          await this.decisionLog.record(manager, {
            ...decisionFields,
            step: AgentDecisionStep.CONFIRM,
            latencyMs: Date.now() - authorizeStart,
          });
        }

        // Transactional outbox (issue #6): the notify job commits atomically
        // with the booking, so a confirmed reservation can never end up
        // without one — the worker (a separate process) drains this queue
        // independently, so a notifier outage never slows or fails a booking.
        await manager.save(
          NotificationJob,
          manager.create(NotificationJob, {
            reservationId: saved.id,
            userId,
            message: `Reservation confirmed: table ${dto.tableId}, slot ${dto.slotId}.`,
          }),
        );
        return saved;
      });
    } catch (err) {
      if (err instanceof MandateDeniedError) {
        throw new HttpException({ message: err.message, verdict: 'DENY', reason: err.reason }, HttpStatus.FORBIDDEN);
      }
      return this.translateBookingError(err, userId);
    }

    await this.events.publish({
      type: 'confirmed',
      cafeId: table.cafeId,
      tableId: dto.tableId,
      slotId: dto.slotId,
    });
    return reservation;
  }

  findMine(userId: string): Promise<Reservation[]> {
    return this.reservations.find({
      where: { userId },
      relations: { table: { cafe: true }, slot: true },
      order: { createdAt: 'DESC' },
    });
  }

  async cancel(userId: string, reservationId: string): Promise<void> {
    const reservation = await this.reservations.findOne({ where: { id: reservationId } });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    if (reservation.userId !== userId) {
      throw new ForbiddenException('You can only cancel your own reservations');
    }
    // Idempotent: a reservation is only ever charged once (booked), so it
    // should only ever be refunded once — cancelling an already-cancelled
    // reservation is a no-op rather than a second refund (issue #21).
    if (reservation.status !== ReservationStatus.BOOKED) {
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Reservation, { id: reservation.id }, { status: ReservationStatus.CANCELLED });
      // Issue #3: refund exactly what was charged — the Payment row, not
      // the slot's current price — so a refund can never diverge even if
      // something else changed the slot's price after this booking.
      const payment = await manager.findOneOrFail(Payment, { where: { reservationId: reservation.id } });
      await this.refundWallet(manager, userId, payment.amount);
      await this.enqueueWebhookJob(manager, WebhookEventType.BOOKING_CANCELLED, reservation);
    });

    const table = await this.tables.findOneOrFail({ where: { id: reservation.tableId } });
    await this.events.publish({
      type: 'cancelled',
      cafeId: table.cafeId,
      tableId: reservation.tableId,
      slotId: reservation.slotId,
    });
  }
}
