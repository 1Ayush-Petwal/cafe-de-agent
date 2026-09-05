import { Controller, Get, MessageEvent, Param, Query, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { Cafe } from '../entities/cafe.entity';
import { AvailabilityEventsService } from '../realtime/availability-events.service';
import { AlternativesQueryDto } from './dto/alternatives-query.dto';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { ListCafesQueryDto } from './dto/list-cafes-query.dto';
import { AlternativeSlot, CafesService, TableAvailability } from './cafes.service';

@Controller('cafes')
export class CafesController {
  constructor(
    private readonly cafes: CafesService,
    private readonly events: AvailabilityEventsService,
  ) {}

  @Get()
  findAll(@Query() query: ListCafesQueryDto): Promise<Cafe[]> {
    return this.cafes.findAll(query);
  }

  @Get(':id/availability')
  getAvailability(
    @Param('id') id: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<TableAvailability[]> {
    return this.cafes.getAvailability(id, query.date);
  }

  /**
   * Issue #10 (PRD area F): up to two alternative table+slot candidates,
   * cold-and-available ones preferred, mandate-screened when `mandateId` is
   * given. Authenticated — unlike plain availability, screening against a
   * mandate needs to know whose mandate it is.
   */
  @Get(':id/alternatives')
  @UseGuards(JwtAuthGuard)
  findAlternatives(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: AlternativesQueryDto,
  ): Promise<AlternativeSlot[]> {
    return this.cafes.findAlternatives(id, {
      date: query.date,
      excludeSlotId: query.excludeSlotId,
      mandateId: query.mandateId,
      userId: user.sub,
    });
  }

  /**
   * M4 (issue #7): booking state changes for this café, pushed over SSE via
   * the Redis pub/sub backplane (AvailabilityEventsService). Clients treat
   * any message as "something changed, refetch" rather than reconciling the
   * payload — the grid stays a straightforward re-GET of the source of
   * truth, never a client-side merge of partial events.
   */
  @Sse(':id/availability/stream')
  streamAvailability(@Param('id') id: string): Observable<MessageEvent> {
    return this.events.stream(id);
  }
}
