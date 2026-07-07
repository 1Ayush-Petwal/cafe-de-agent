import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '../cache/cache.module';
import { CafeTable } from '../entities/cafe-table.entity';
import { Cafe } from '../entities/cafe.entity';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cafe, CafeTable, Slot, Reservation]), CacheModule],
  controllers: [OwnerController],
  providers: [OwnerService],
})
export class OwnerModule {}
