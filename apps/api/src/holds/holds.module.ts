import { Module } from '@nestjs/common';
import { HoldsService } from './holds.service';

@Module({
  providers: [HoldsService],
  exports: [HoldsService],
})
export class HoldsModule {}
