import { Module } from '@nestjs/common';
import { AvailabilityCacheService } from './availability-cache.service';

@Module({
  providers: [AvailabilityCacheService],
  exports: [AvailabilityCacheService],
})
export class CacheModule {}
