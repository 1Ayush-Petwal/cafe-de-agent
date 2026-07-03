import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { AvailabilityEventsService } from './availability-events.service';

@Module({
  imports: [CacheModule],
  providers: [AvailabilityEventsService],
  exports: [AvailabilityEventsService],
})
export class RealtimeModule {}
