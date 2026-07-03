import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CafeTable } from '../entities/cafe-table.entity';
import { Cafe } from '../entities/cafe.entity';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { HoldsModule } from '../holds/holds.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CafesController } from './cafes.controller';
import { CafesService } from './cafes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cafe, CafeTable, Slot, Reservation]), HoldsModule, RealtimeModule],
  controllers: [CafesController],
  providers: [CafesService],
  exports: [CafesService],
})
export class CafesModule {}
