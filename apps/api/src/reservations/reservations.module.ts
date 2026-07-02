import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CafeTable } from '../entities/cafe-table.entity';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation, CafeTable, Slot]), AuthModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
