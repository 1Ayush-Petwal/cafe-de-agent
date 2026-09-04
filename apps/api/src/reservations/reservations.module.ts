import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DecisionsModule } from '../decisions/decisions.module';
import { CafeTable } from '../entities/cafe-table.entity';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { Payment } from '../entities/payment.entity';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { User } from '../entities/user.entity';
import { HoldsModule } from '../holds/holds.module';
import { MandatesModule } from '../mandates/mandates.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, CafeTable, Slot, Payment, IdempotencyKey, User]),
    AuthModule,
    HoldsModule,
    RealtimeModule,
    MandatesModule,
    DecisionsModule,
  ],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
