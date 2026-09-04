import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mandate } from '../entities/mandate.entity';
import { MandateStatus } from '../entities/mandate-status.enum';
import { CreateMandateDto } from './dto/create-mandate.dto';
import { signMandateConstraints } from './mandate-signature';

/** What a customer sees: the signed grant plus the headroom derived from it. */
export interface MandateView {
  id: string;
  userId: string;
  maxPerBookingMinor: number;
  maxTotalMinor: number;
  maxBookings: number;
  allowedLocalities: string[];
  windowStart: Date;
  windowEnd: Date;
  consumedMinor: number;
  consumedBookings: number;
  remainingMinor: number;
  remainingBookings: number;
  status: MandateStatus;
  expiresAt: Date;
  revokedAt: Date | null;
  signature: string;
  createdAt: Date;
}

function toView(mandate: Mandate): MandateView {
  return {
    id: mandate.id,
    userId: mandate.userId,
    maxPerBookingMinor: mandate.maxPerBookingMinor,
    maxTotalMinor: mandate.maxTotalMinor,
    maxBookings: mandate.maxBookings,
    allowedLocalities: mandate.allowedLocalities,
    windowStart: mandate.windowStart,
    windowEnd: mandate.windowEnd,
    consumedMinor: mandate.consumedMinor,
    consumedBookings: mandate.consumedBookings,
    remainingMinor: Math.max(0, mandate.maxTotalMinor - mandate.consumedMinor),
    remainingBookings: Math.max(0, mandate.maxBookings - mandate.consumedBookings),
    status: mandate.status,
    expiresAt: mandate.expiresAt,
    revokedAt: mandate.revokedAt,
    signature: mandate.signature,
    createdAt: mandate.createdAt,
  };
}

@Injectable()
export class MandatesService {
  constructor(@InjectRepository(Mandate) private readonly mandates: Repository<Mandate>) {}

  async grant(userId: string, dto: CreateMandateDto): Promise<MandateView> {
    const windowStart = new Date(dto.windowStart);
    const windowEnd = new Date(dto.windowEnd);
    if (windowEnd <= windowStart) {
      throw new BadRequestException('windowEnd must be after windowStart');
    }
    if (dto.maxPerBookingMinor > dto.maxTotalMinor) {
      throw new BadRequestException('maxPerBookingMinor cannot exceed maxTotalMinor');
    }

    const signature = signMandateConstraints({
      maxPerBookingMinor: dto.maxPerBookingMinor,
      maxTotalMinor: dto.maxTotalMinor,
      maxBookings: dto.maxBookings,
      allowedLocalities: dto.allowedLocalities,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });

    const mandate = await this.mandates.save(
      this.mandates.create({
        userId,
        maxPerBookingMinor: dto.maxPerBookingMinor,
        maxTotalMinor: dto.maxTotalMinor,
        maxBookings: dto.maxBookings,
        allowedLocalities: dto.allowedLocalities,
        windowStart,
        windowEnd,
        expiresAt: windowEnd,
        signature,
      }),
    );
    return toView(mandate);
  }

  async getStatus(userId: string, mandateId: string): Promise<MandateView> {
    return toView(await this.findOwned(userId, mandateId));
  }

  async revoke(userId: string, mandateId: string): Promise<MandateView> {
    const mandate = await this.findOwned(userId, mandateId);
    if (mandate.status !== MandateStatus.REVOKED) {
      mandate.status = MandateStatus.REVOKED;
      mandate.revokedAt = new Date();
      await this.mandates.save(mandate);
    }
    return toView(mandate);
  }

  private async findOwned(userId: string, mandateId: string): Promise<Mandate> {
    const mandate = await this.mandates.findOne({ where: { id: mandateId } });
    if (!mandate) throw new NotFoundException('Mandate not found');
    if (mandate.userId !== userId) throw new ForbiddenException('Not your mandate');
    return mandate;
  }
}
