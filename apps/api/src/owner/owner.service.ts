import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { CafeTable } from '../entities/cafe-table.entity';
import { Cafe } from '../entities/cafe.entity';
import { ReservationStatus } from '../entities/reservation-status.enum';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import {
  OPENING_HOUR_UTC,
  CLOSING_HOUR_UTC,
  TURN_TIME_MINUTES,
  dailySlotTimesConfigurable,
  toDateOnly,
} from '../seed/slot-grid';
import { CreateCafeDto } from './dto/create-cafe.dto';
import { CreateTableDto } from './dto/create-table.dto';
import { GenerateSlotsDto } from './dto/generate-slots.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Injectable()
export class OwnerService {
  constructor(
    @InjectRepository(Cafe) private readonly cafes: Repository<Cafe>,
    @InjectRepository(CafeTable) private readonly tables: Repository<CafeTable>,
    @InjectRepository(Slot) private readonly slots: Repository<Slot>,
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
  ) {}

  createCafe(ownerId: string, dto: CreateCafeDto): Promise<Cafe> {
    return this.cafes.save(
      this.cafes.create({
        name: dto.name,
        area: dto.area,
        description: dto.description ?? '',
        ownerId,
      }),
    );
  }

  listMyCafes(ownerId: string): Promise<Cafe[]> {
    return this.cafes.find({ where: { ownerId }, order: { name: 'ASC' } });
  }

  /** Throws NotFound if the café doesn't exist, Forbidden if it isn't owned by this owner. */
  async requireOwnedCafe(ownerId: string, cafeId: string): Promise<Cafe> {
    const cafe = await this.cafes.findOne({ where: { id: cafeId } });
    if (!cafe) {
      throw new NotFoundException('Cafe not found');
    }
    if (cafe.ownerId !== ownerId) {
      throw new ForbiddenException("Not your cafe");
    }
    return cafe;
  }

  async createTable(ownerId: string, cafeId: string, dto: CreateTableDto): Promise<CafeTable> {
    await this.requireOwnedCafe(ownerId, cafeId);
    return this.tables.save(
      this.tables.create({ cafeId, label: dto.label, capacity: dto.capacity }),
    );
  }

  async listTables(ownerId: string, cafeId: string): Promise<CafeTable[]> {
    await this.requireOwnedCafe(ownerId, cafeId);
    return this.tables.find({ where: { cafeId }, order: { label: 'ASC' } });
  }

  async updateTable(
    ownerId: string,
    cafeId: string,
    tableId: string,
    dto: UpdateTableDto,
  ): Promise<CafeTable> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const table = await this.tables.findOne({ where: { id: tableId, cafeId } });
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    Object.assign(table, dto);
    return this.tables.save(table);
  }

  /** Generates (or extends) the daily slot grid for this café; skips dates that already have slots. */
  async generateSlots(ownerId: string, cafeId: string, dto: GenerateSlotsDto): Promise<Slot[]> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const days = dto.days ?? 14;
    const openHour = dto.openHour ?? OPENING_HOUR_UTC;
    const closeHour = dto.closeHour ?? CLOSING_HOUR_UTC;
    const turnTimeMinutes = dto.turnTimeMinutes ?? TURN_TIME_MINUTES;
    if (closeHour <= openHour) {
      throw new ForbiddenException('closeHour must be after openHour');
    }

    const start = new Date(`${dto.startDate}T00:00:00.000Z`);
    const dateStrings = Array.from({ length: days }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      return toDateOnly(d);
    });

    const candidateTimes = dateStrings.flatMap((dateOnly) =>
      dailySlotTimesConfigurable(dateOnly, openHour, closeHour, turnTimeMinutes),
    );
    if (candidateTimes.length === 0) {
      return [];
    }

    const existing = await this.slots.find({
      where: {
        cafeId,
        slotTime: Between(candidateTimes[0], candidateTimes[candidateTimes.length - 1]),
      },
    });
    const existingTimes = new Set(existing.map((s) => s.slotTime.getTime()));
    const toCreate = candidateTimes.filter((t) => !existingTimes.has(t.getTime()));
    if (toCreate.length === 0) {
      return [];
    }
    return this.slots.save(toCreate.map((slotTime) => this.slots.create({ cafeId, slotTime })));
  }

  async bookingsForDay(ownerId: string, cafeId: string, date: string): Promise<Reservation[]> {
    await this.requireOwnedCafe(ownerId, cafeId);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    const daySlots = await this.slots.find({
      where: { cafeId, slotTime: Between(dayStart, dayEnd) },
    });
    if (daySlots.length === 0) {
      return [];
    }
    return this.reservations.find({
      where: {
        slotId: In(daySlots.map((s) => s.id)),
        status: ReservationStatus.BOOKED,
      },
      relations: ['table', 'slot', 'user'],
      order: { createdAt: 'ASC' },
    });
  }
}
