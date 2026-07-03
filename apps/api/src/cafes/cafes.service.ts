import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AvailabilityCacheService } from '../cache/availability-cache.service';
import { CafeTable } from '../entities/cafe-table.entity';
import { Cafe } from '../entities/cafe.entity';
import { ReservationStatus } from '../entities/reservation-status.enum';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { HoldsService } from '../holds/holds.service';

export interface AvailabilitySlot {
  slotId: string;
  slotTime: Date;
  available: boolean;
}

export interface TableAvailability {
  tableId: string;
  label: string;
  capacity: number;
  slots: AvailabilitySlot[];
}

@Injectable()
export class CafesService {
  constructor(
    @InjectRepository(Cafe) private readonly cafes: Repository<Cafe>,
    @InjectRepository(CafeTable) private readonly tables: Repository<CafeTable>,
    @InjectRepository(Slot) private readonly slots: Repository<Slot>,
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    private readonly holds: HoldsService,
    private readonly availabilityCache: AvailabilityCacheService,
  ) {}

  /**
   * M6 (issue #13): café search served cache-aside — a short Redis TTL
   * absorbs read traffic; the list only changes when an owner creates a
   * café (rare), so no event-based invalidation is needed here (contrast
   * getAvailability, which booking events do invalidate).
   */
  async findAll(): Promise<Cafe[]> {
    const cached = await this.availabilityCache.getCafeList<Cafe[]>();
    if (cached) {
      return cached;
    }
    const cafes = await this.cafes.find({ order: { name: 'ASC' } });
    await this.availabilityCache.setCafeList(cafes);
    return cafes;
  }

  async findOne(cafeId: string): Promise<Cafe> {
    const cafe = await this.cafes.findOne({ where: { id: cafeId } });
    if (!cafe) {
      throw new NotFoundException('Cafe not found');
    }
    return cafe;
  }

  /**
   * M6 (issue #13): cache-aside with a short TTL, invalidated on any
   * booking-state change for this café (AvailabilityEventsService.publish).
   * The cache is a hint, never booking truth — hold()/executeConfirm() in
   * ReservationsService never read from it, so a stale hit here can only
   * ever make a free slot look busy, never the reverse.
   */
  async getAvailability(cafeId: string, date: string): Promise<TableAvailability[]> {
    await this.findOne(cafeId);

    const cached = await this.availabilityCache.get<TableAvailability[]>(cafeId, date);
    if (cached) {
      return cached;
    }

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const [tables, daySlots] = await Promise.all([
      this.tables.find({ where: { cafeId }, order: { label: 'ASC' } }),
      this.slots.find({
        where: { cafeId, slotTime: Between(dayStart, dayEnd) },
        order: { slotTime: 'ASC' },
      }),
    ]);

    if (tables.length === 0 || daySlots.length === 0) {
      const empty = tables.map((table) => ({
        tableId: table.id,
        label: table.label,
        capacity: table.capacity,
        slots: [],
      }));
      await this.availabilityCache.set(cafeId, date, empty);
      return empty;
    }

    const tableIds = tables.map((t) => t.id);
    const slotIds = daySlots.map((s) => s.id);
    const [booked, held] = await Promise.all([
      this.reservationsFor(tableIds, slotIds),
      this.holds.getHeldPairs(tableIds, slotIds),
    ]);
    const bookedKeys = new Set(booked.map((r) => `${r.tableId}:${r.slotId}`));

    const result = tables.map((table) => ({
      tableId: table.id,
      label: table.label,
      capacity: table.capacity,
      slots: daySlots.map((slot) => ({
        slotId: slot.id,
        slotTime: slot.slotTime,
        available:
          table.inService &&
          !bookedKeys.has(`${table.id}:${slot.id}`) &&
          !held.has(`${table.id}:${slot.id}`),
      })),
    }));
    await this.availabilityCache.set(cafeId, date, result);
    return result;
  }

  private async reservationsFor(tableIds: string[], slotIds: string[]): Promise<Reservation[]> {
    if (tableIds.length === 0 || slotIds.length === 0) {
      return [];
    }
    return this.reservations
      .createQueryBuilder('r')
      .where('r.tableId IN (:...tableIds)', { tableIds })
      .andWhere('r.slotId IN (:...slotIds)', { slotIds })
      .andWhere('r.status = :status', { status: ReservationStatus.BOOKED })
      .getMany();
  }
}
