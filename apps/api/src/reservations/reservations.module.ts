import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CafeTable } from '../entities/cafe-table.entity';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { Payment } from '../entities/payment.entity';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { HoldsModule } from '../holds/holds.module';
import { PaymentsModule } from '../payments/payments.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, CafeTable, Slot, Payment, IdempotencyKey]),
    AuthModule,
    HoldsModule,
    PaymentsModule,
    RealtimeModule,
  ],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
