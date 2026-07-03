import { Module } from '@nestjs/common';
import { AvailabilityEventsService } from './availability-events.service';

@Module({
  providers: [AvailabilityEventsService],
  exports: [AvailabilityEventsService],
})
export class RealtimeModule {}
