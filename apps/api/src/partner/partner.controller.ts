import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AvailabilityQueryDto } from '../cafes/dto/availability-query.dto';
import { TableAvailability } from '../cafes/cafes.service';
import { Reservation } from '../entities/reservation.entity';
import { ApiKeyGuard, PartnerApiKeyContext } from './api-key.guard';
import { CurrentPartnerKey } from './current-partner-key.decorator';
import { PartnerService } from './partner.service';

/**
 * Partner API v1 pull endpoints (issue #24, PRD area G): café-scoped
 * reconciliation for a partner's local app after downtime, authenticated by
 * per-café API key rather than the customer/owner JWT. No endpoint here lets
 * a partner create, cancel, or hold anything — one-way sync only (two-way
 * sync, letting a partner block platform slots, is explicitly v2).
 */
@Controller('partner/cafes/:cafeId')
@UseGuards(ApiKeyGuard)
export class PartnerController {
  constructor(private readonly partner: PartnerService) {}

  @Get('bookings')
  bookingsForDay(
    @CurrentPartnerKey() key: PartnerApiKeyContext,
    @Param('cafeId') cafeId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<Reservation[]> {
    return this.partner.bookingsForDay(key.cafeId, cafeId, query.date);
  }

  @Get('availability')
  availability(
    @CurrentPartnerKey() key: PartnerApiKeyContext,
    @Param('cafeId') cafeId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<TableAvailability[]> {
    return this.partner.availabilityForDay(key.cafeId, cafeId, query.date);
  }
}
