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
import { MandatesService } from '../mandates/mandates.service';
import { computeDemandScore, isCold, nudgeMinor } from './demand';

/** MAX_ALTERNATIVES per PRD area F (issue #10): at most two per request, or a counter-offering agent becomes spam. */
export const MAX_ALTERNATIVES = 2;

export interface AlternativeSlot {
  tableId: string;
  slotId: string;
  slotTime: Date;
  priceMinor: number;
  discountedPriceMinor: number;
  cold: boolean;
}

export interface FindAlternativesInput {
  date: string;
  excludeSlotId?: string;
  mandateId?: string;
  userId: string;
}

export interface AvailabilitySlot {
  slotId: string;
  slotTime: Date;
  available: boolean;
  priceMinor: number;
  /** PRD area F (issue #10): 0..1, historical fill rate blended with live hold pressure. */
  demandScore: number;
  cold: boolean;
  /** Equal to priceMinor unless `cold` — a hot slot is never discounted at any size. */
  discountedPriceMinor: number;
}

export interface TableAvailability {
  tableId: string;
  label: string;
  capacity: number;
  slots: AvailabilitySlot[];
}

export interface CafeListFilters {
  region?: string;
  cuisine?: string;
  sort?: 'rating';
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
    private readonly mandates: MandatesService,
  ) {}

  /**
   * M6 (issue #13): café search served cache-aside — a short Redis TTL
   * absorbs read traffic; the list only changes when an owner creates a
   * café (rare), so no event-based invalidation is needed here (contrast
   * getAvailability, which booking events do invalidate).
   *
   * Issue #18: store-locator filters (region/cuisine) and rating sort are
   * applied *after* the cache read against the full unfiltered list. The
   * cache always holds the whole list under one key — filtering here rather
   * than per-filter cache keys avoids cache-key explosion for a tiny list.
   */
  async findAll(filters: CafeListFilters = {}): Promise<Cafe[]> {
    let cafes = await this.availabilityCache.getCafeList<Cafe[]>();
    if (!cafes) {
      cafes = await this.cafes.find({ order: { name: 'ASC' } });
      await this.availabilityCache.setCafeList(cafes);
    }

    if (filters.region) {
      cafes = cafes.filter((c) => c.region === filters.region);
    }
    if (filters.cuisine) {
      cafes = cafes.filter((c) => (c.cuisines ?? []).includes(filters.cuisine!));
    }
    if (filters.sort === 'rating') {
      // Copy before sorting so we never mutate the cached array in place.
      cafes = [...cafes].sort((a, b) => b.rating - a.rating);
    }
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
    const cafe = await this.findOne(cafeId);

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

    // PRD area F (issue #10): historical fill rate is a function of
    // (café, weekday, hour) only, shared by every table — computed once per
    // hour bucket present in this day's grid, not per (table, slot) pair.
    const dayOfWeek = daySlots[0].slotTime.getUTCDay();
    const fillRateByHour = await this.historicalFillRateByHour(cafeId, dayOfWeek, tables.length);

    const demandBySlot = new Map(
      daySlots.map((slot) => {
        const fillRate = fillRateByHour.get(slot.slotTime.getUTCHours()) ?? 0;
        // Hold pressure, unlike fill rate, is inherently live and slot-
        // specific: how many of this exact slot's tables are held *right
        // now*, out of every table at this café.
        const heldForSlot = tables.reduce(
          (count, t) => count + (held.has(`${t.id}:${slot.id}`) ? 1 : 0),
          0,
        );
        const holdPressure = tables.length === 0 ? 0 : heldForSlot / tables.length;
        const demandScore = computeDemandScore(fillRate, holdPressure);
        const cold = isCold(demandScore);
        const discountedPriceMinor = slot.priceMinor - nudgeMinor(slot.priceMinor, cafe.maxDiscountMinor, cold);
        return [slot.id, { demandScore, cold, discountedPriceMinor }] as const;
      }),
    );

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
        priceMinor: slot.priceMinor,
        ...demandBySlot.get(slot.id)!,
      })),
    }));
    await this.availabilityCache.set(cafeId, date, result);
    return result;
  }

  /**
   * Issue #10 (PRD area F): up to two alternative table+slot candidates for
   * a café on a date, offered when the buyer's requested slot is
   * unavailable (or simply cold) — cold, currently-available candidates are
   * preferred first since converting them is the whole point of the
   * mechanic, then earliest first. When a mandate is attached, every
   * candidate is screened through the same `previewMandate` the confirm
   * path itself is advised by, so an alternative the mandate would refuse
   * is filtered out here rather than proposed and then denied.
   */
  async findAlternatives(cafeId: string, input: FindAlternativesInput): Promise<AlternativeSlot[]> {
    const tableAvailability = await this.getAvailability(cafeId, input.date);

    const candidates: AlternativeSlot[] = [];
    for (const table of tableAvailability) {
      for (const slot of table.slots) {
        if (!slot.available || slot.slotId === input.excludeSlotId) {
          continue;
        }
        candidates.push({
          tableId: table.tableId,
          slotId: slot.slotId,
          // A cache hit round-trips through JSON, which leaves slotTime a
          // string rather than a Date — normalise here since sorting below
          // needs a real Date regardless of whether this came from the
          // cache or a fresh computation.
          slotTime: new Date(slot.slotTime),
          priceMinor: slot.priceMinor,
          discountedPriceMinor: slot.discountedPriceMinor,
          cold: slot.cold,
        });
      }
    }
    candidates.sort((a, b) => {
      if (a.cold !== b.cold) return a.cold ? -1 : 1;
      return a.slotTime.getTime() - b.slotTime.getTime();
    });

    const alternatives: AlternativeSlot[] = [];
    for (const candidate of candidates) {
      if (alternatives.length >= MAX_ALTERNATIVES) {
        break;
      }
      if (input.mandateId) {
        const verdict = await this.mandates.previewMandate(input.userId, input.mandateId, {
          tableId: candidate.tableId,
          slotId: candidate.slotId,
        });
        if (verdict.verdict === 'DENY') {
          continue;
        }
      }
      alternatives.push(candidate);
    }
    return alternatives;
  }

  /**
   * Issue #10 (PRD area F): historical fill rate per hour bucket for this
   * café's weekday, from every past slot regardless of which table sold —
   * `bookedCount` is the number of BOOKED reservations against slots in that
   * bucket (fanning out one row per table via the join), `slotCount` the
   * number of distinct past slots, so `bookedCount / (slotCount * tableCount)`
   * is the fraction of (table, slot) opportunities that historically sold.
   * Needs the seed's several weeks of past bookings — with none, every hour
   * comes back with no row here and callers treat that as a fill rate of 0.
   */
  private async historicalFillRateByHour(
    cafeId: string,
    dayOfWeek: number,
    tableCount: number,
  ): Promise<Map<number, number>> {
    if (tableCount === 0) {
      return new Map();
    }
    const rows = await this.slots
      .createQueryBuilder('s')
      .leftJoin(Reservation, 'r', 'r."slotId" = s.id AND r.status = :status', {
        status: ReservationStatus.BOOKED,
      })
      .select('EXTRACT(HOUR FROM s."slotTime")::int', 'hour')
      .addSelect('COUNT(DISTINCT s.id)', 'slotCount')
      .addSelect('COUNT(r.id)', 'bookedCount')
      .where('s."cafeId" = :cafeId', { cafeId })
      .andWhere('EXTRACT(DOW FROM s."slotTime") = :dayOfWeek', { dayOfWeek })
      .andWhere('s."slotTime" < :now', { now: new Date() })
      .groupBy('EXTRACT(HOUR FROM s."slotTime")::int')
      .getRawMany<{ hour: string; slotCount: string; bookedCount: string }>();

    const byHour = new Map<number, number>();
    for (const row of rows) {
      const slotCount = Number(row.slotCount);
      const totalPairs = slotCount * tableCount;
      byHour.set(Number(row.hour), totalPairs === 0 ? 0 : Number(row.bookedCount) / totalPairs);
    }
    return byHour;
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
