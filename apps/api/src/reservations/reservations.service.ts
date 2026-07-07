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
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CafeTable } from '../entities/cafe-table.entity';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { NotificationJob } from '../entities/notification-job.entity';
import { Payment } from '../entities/payment.entity';
import { ReservationStatus } from '../entities/reservation-status.enum';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { Hold, HoldsService } from '../holds/holds.service';
import { PaymentsService } from '../payments/payments.service';
import { AvailabilityEventsService } from '../realtime/availability-events.service';
import { BookingStrategy } from './booking-strategy.enum';
import { ConfirmHoldDto } from './dto/confirm-hold.dto';
import { CreateHoldDto } from './dto/create-hold.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';

const TAKEN_MESSAGE = 'This table is already booked for that slot';
const PAYMENT_FAILED_MESSAGE = 'Payment failed — please try again';
const UNIQUE_VIOLATION = '23505';
const OPTIMISTIC_MAX_ATTEMPTS = 10;
const DEFAULT_HOLD_TTL_SECONDS = 90;
/** Issue #17 (PRD area B): one active reservation per user per café within any rolling 10-hour window. */
const BOOKING_WINDOW_MS = 10 * 60 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === UNIQUE_VIOLATION;
}

@Injectable()
export class ReservationsService {
  private readonly holdTtlSeconds: number;

  constructor(
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    @InjectRepository(CafeTable) private readonly tables: Repository<CafeTable>,
    @InjectRepository(Slot) private readonly slots: Repository<Slot>,
    @InjectRepository(IdempotencyKey) private readonly idempotencyKeys: Repository<IdempotencyKey>,
    private readonly dataSource: DataSource,
    private readonly holds: HoldsService,
    private readonly paymentGateway: PaymentsService,
    private readonly events: AvailabilityEventsService,
  ) {
    this.holdTtlSeconds = Number(process.env.HOLD_TTL_SECONDS) || DEFAULT_HOLD_TTL_SECONDS;
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
  private async assertWithinWindowFree(
    userId: string,
    cafeId: string,
    tableId: string,
    slotId: string,
    slotTime: Date,
  ): Promise<void> {
    const windowStart = new Date(slotTime.getTime() - BOOKING_WINDOW_MS);
    const windowEnd = new Date(slotTime.getTime() + BOOKING_WINDOW_MS);
    const conflict = await this.reservations
      .createQueryBuilder('r')
      .innerJoin(Slot, 's', 's.id = r."slotId"')
      .where('r."userId" = :userId', { userId })
      .andWhere('r.status = :status', { status: ReservationStatus.BOOKED })
      .andWhere('s."cafeId" = :cafeId', { cafeId })
      .andWhere('s."slotTime" > :windowStart', { windowStart })
      .andWhere('s."slotTime" < :windowEnd', { windowEnd })
      .andWhere('NOT (r."tableId" = :selfTable AND r."slotId" = :selfSlot)', {
        selfTable: tableId,
        selfSlot: slotId,
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

    await this.assertWithinWindowFree(userId, table.cafeId, dto.tableId, dto.slotId, slot.slotTime);

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
    try {
      return await this.reservations.save(
        this.reservations.create({
          userId,
          tableId: dto.tableId,
          slotId: dto.slotId,
          status: ReservationStatus.BOOKED,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(TAKEN_MESSAGE);
      }
      throw err;
    }
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

      const reservation = queryRunner.manager.create(Reservation, {
        userId,
        tableId: dto.tableId,
        slotId: dto.slotId,
        status: ReservationStatus.BOOKED,
      });
      const saved = await queryRunner.manager.save(reservation);
      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      if (isUniqueViolation(err)) {
        throw new ConflictException(TAKEN_MESSAGE);
      }
      throw err;
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

      try {
        return await this.reservations.save(
          this.reservations.create({
            userId,
            tableId: dto.tableId,
            slotId: dto.slotId,
            status: ReservationStatus.BOOKED,
          }),
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(TAKEN_MESSAGE);
        }
        throw err;
      }
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
    await this.assertWithinWindowFree(userId, table.cafeId, dto.tableId, dto.slotId, slot.slotTime);

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
      return this.executeConfirm(userId, dto);
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
      const reservation = await this.executeConfirm(userId, dto);
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
   * The mock charge (issue #5) runs after the hold is consumed and before
   * the reservation is written: the hold key is already gone by the time we
   * know the payment outcome, so a failed charge needs no separate
   * "release the hold" step — the slot is already free — and simply leaves
   * no reservation or payment row behind.
   */
  private async executeConfirm(userId: string, dto: ConfirmHoldDto): Promise<Reservation> {
    // Authoritative re-check of the 10-hour window (issue #17): the hold may
    // have been taken before a conflicting booking at this café existed, so
    // re-validate here alongside the write rather than trusting the hold-time
    // check. Run before consuming the hold so a rejected confirm leaves the
    // hold intact for a legitimate retry after cancelling the conflict.
    const slot = await this.slots.findOneOrFail({ where: { id: dto.slotId } });
    await this.assertWithinWindowFree(userId, slot.cafeId, dto.tableId, dto.slotId, slot.slotTime);

    const consumed = await this.holds.consume(userId, dto.tableId, dto.slotId, dto.holdId);
    if (!consumed) {
      throw new GoneException('Your hold expired or was already used — please try again');
    }

    const charged = await this.paymentGateway.charge();
    if (!charged) {
      throw new HttpException(PAYMENT_FAILED_MESSAGE, HttpStatus.PAYMENT_REQUIRED);
    }

    let reservation: Reservation;
    try {
      reservation = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.save(
          Reservation,
          manager.create(Reservation, {
            userId,
            tableId: dto.tableId,
            slotId: dto.slotId,
            status: ReservationStatus.BOOKED,
          }),
        );
        await manager.save(Payment, manager.create(Payment, { reservationId: saved.id }));
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
      if (isUniqueViolation(err)) {
        throw new ConflictException(TAKEN_MESSAGE);
      }
      throw err;
    }

    const table = await this.tables.findOneOrFail({ where: { id: dto.tableId } });
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
    reservation.status = ReservationStatus.CANCELLED;
    await this.reservations.save(reservation);

    const table = await this.tables.findOneOrFail({ where: { id: reservation.tableId } });
    await this.events.publish({
      type: 'cancelled',
      cafeId: table.cafeId,
      tableId: reservation.tableId,
      slotId: reservation.slotId,
    });
  }
}
