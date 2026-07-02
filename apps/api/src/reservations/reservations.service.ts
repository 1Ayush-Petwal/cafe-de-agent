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
import { Payment } from '../entities/payment.entity';
import { ReservationStatus } from '../entities/reservation-status.enum';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { Hold, HoldsService } from '../holds/holds.service';
import { PaymentsService } from '../payments/payments.service';
import { BookingStrategy } from './booking-strategy.enum';
import { ConfirmHoldDto } from './dto/confirm-hold.dto';
import { CreateHoldDto } from './dto/create-hold.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';

const TAKEN_MESSAGE = 'This table is already booked for that slot';
const PAYMENT_FAILED_MESSAGE = 'Payment failed — please try again';
const UNIQUE_VIOLATION = '23505';
const OPTIMISTIC_MAX_ATTEMPTS = 10;
const DEFAULT_HOLD_TTL_SECONDS = 90;

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
    private readonly dataSource: DataSource,
    private readonly holds: HoldsService,
    private readonly paymentGateway: PaymentsService,
  ) {
    this.holdTtlSeconds = Number(process.env.HOLD_TTL_SECONDS) || DEFAULT_HOLD_TTL_SECONDS;
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

    const hold = await this.holds.create(userId, dto.tableId, dto.slotId, this.holdTtlSeconds);
    if (!hold) {
      throw new ConflictException('This table is already held for that slot');
    }
    return hold;
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
  async confirmHold(userId: string, dto: ConfirmHoldDto): Promise<Reservation> {
    const consumed = await this.holds.consume(userId, dto.tableId, dto.slotId, dto.holdId);
    if (!consumed) {
      throw new GoneException('Your hold expired or was already used — please try again');
    }

    const charged = await this.paymentGateway.charge();
    if (!charged) {
      throw new HttpException(PAYMENT_FAILED_MESSAGE, HttpStatus.PAYMENT_REQUIRED);
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const reservation = await manager.save(
          Reservation,
          manager.create(Reservation, {
            userId,
            tableId: dto.tableId,
            slotId: dto.slotId,
            status: ReservationStatus.BOOKED,
          }),
        );
        await manager.save(Payment, manager.create(Payment, { reservationId: reservation.id }));
        return reservation;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(TAKEN_MESSAGE);
      }
      throw err;
    }
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
  }
}
