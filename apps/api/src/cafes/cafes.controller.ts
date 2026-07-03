import { Controller, Get, MessageEvent, Param, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Cafe } from '../entities/cafe.entity';
import { AvailabilityEventsService } from '../realtime/availability-events.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { CafesService, TableAvailability } from './cafes.service';

@Controller('cafes')
export class CafesController {
  constructor(
    private readonly cafes: CafesService,
    private readonly events: AvailabilityEventsService,
  ) {}

  @Get()
  findAll(): Promise<Cafe[]> {
    return this.cafes.findAll();
  }

  @Get(':id/availability')
  getAvailability(
    @Param('id') id: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<TableAvailability[]> {
    return this.cafes.getAvailability(id, query.date);
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
