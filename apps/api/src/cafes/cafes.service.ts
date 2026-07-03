import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
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
  ) {}

  findAll(): Promise<Cafe[]> {
    return this.cafes.find({ order: { name: 'ASC' } });
  }

  async findOne(cafeId: string): Promise<Cafe> {
    const cafe = await this.cafes.findOne({ where: { id: cafeId } });
    if (!cafe) {
      throw new NotFoundException('Cafe not found');
    }
    return cafe;
  }

  async getAvailability(cafeId: string, date: string): Promise<TableAvailability[]> {
    await this.findOne(cafeId);

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
      return tables.map((table) => ({
        tableId: table.id,
        label: table.label,
        capacity: table.capacity,
        slots: [],
      }));
    }

    const tableIds = tables.map((t) => t.id);
    const slotIds = daySlots.map((s) => s.id);
    const [booked, held] = await Promise.all([
      this.reservationsFor(tableIds, slotIds),
      this.holds.getHeldPairs(tableIds, slotIds),
    ]);
    const bookedKeys = new Set(booked.map((r) => `${r.tableId}:${r.slotId}`));

    return tables.map((table) => ({
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
