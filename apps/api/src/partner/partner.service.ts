import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { CafesService, TableAvailability } from '../cafes/cafes.service';
import { Cafe } from '../entities/cafe.entity';
import { ReservationStatus } from '../entities/reservation-status.enum';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';

@Injectable()
export class PartnerService {
  constructor(
    @InjectRepository(Cafe) private readonly cafes: Repository<Cafe>,
    @InjectRepository(Slot) private readonly slots: Repository<Slot>,
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    private readonly cafesService: CafesService,
  ) {}

  /**
   * Issue #24: a key only grants access to its own café's data. Existence
   * is checked before scope (mirrors `OwnerService.requireOwnedCafe`) so an
   * unknown café id reads as 404 and a real-but-foreign café reads as 403.
   */
  private async requireScopedCafe(keyCafeId: string, cafeId: string): Promise<Cafe> {
    const cafe = await this.cafes.findOne({ where: { id: cafeId } });
    if (!cafe) {
      throw new NotFoundException('Cafe not found');
    }
    if (cafe.id !== keyCafeId) {
      throw new ForbiddenException('This API key is not scoped to that café');
    }
    return cafe;
  }

  async bookingsForDay(keyCafeId: string, cafeId: string, date: string): Promise<Reservation[]> {
    await this.requireScopedCafe(keyCafeId, cafeId);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    const daySlots = await this.slots.find({ where: { cafeId, slotTime: Between(dayStart, dayEnd) } });
    if (daySlots.length === 0) {
      return [];
    }
    return this.reservations.find({
      where: { slotId: In(daySlots.map((s) => s.id)), status: ReservationStatus.BOOKED },
      relations: ['table', 'slot'],
      order: { createdAt: 'ASC' },
    });
  }

  async availabilityForDay(keyCafeId: string, cafeId: string, date: string): Promise<TableAvailability[]> {
    await this.requireScopedCafe(keyCafeId, cafeId);
    return this.cafesService.getAvailability(cafeId, date);
  }
}
