import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CafeTable } from '../entities/cafe-table.entity';
import { ReservationStatus } from '../entities/reservation-status.enum';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    @InjectRepository(CafeTable) private readonly tables: Repository<CafeTable>,
    @InjectRepository(Slot) private readonly slots: Repository<Slot>,
  ) {}

  /**
   * M0: deliberately naive check-then-insert. Two concurrent requests can
   * both pass the "is it free?" check and both insert — that TOCTOU race is
   * the reason M1 exists; do not fix it here.
   */
  async book(userId: string, dto: CreateReservationDto): Promise<Reservation> {
    const [table, slot] = await Promise.all([
      this.tables.findOne({ where: { id: dto.tableId } }),
      this.slots.findOne({ where: { id: dto.slotId } }),
    ]);
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    if (!slot || slot.cafeId !== table.cafeId) {
      throw new NotFoundException('Slot not found for this table');
    }

    const existing = await this.reservations.findOne({
      where: { tableId: dto.tableId, slotId: dto.slotId, status: ReservationStatus.BOOKED },
    });
    if (existing) {
      throw new ConflictException('This table is already booked for that slot');
    }

    return this.reservations.save(
      this.reservations.create({
        userId,
        tableId: dto.tableId,
        slotId: dto.slotId,
        status: ReservationStatus.BOOKED,
      }),
    );
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
