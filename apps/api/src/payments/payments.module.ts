import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DecisionsModule } from '../decisions/decisions.module';
import { CafeTable } from '../entities/cafe-table.entity';
import { Payment } from '../entities/payment.entity';
import { Slot } from '../entities/slot.entity';
import { HoldsModule } from '../holds/holds.module';
import { MandatesModule } from '../mandates/mandates.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayClient } from './razorpay.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([CafeTable, Slot, Payment]),
    HoldsModule,
    MandatesModule,
    ReservationsModule,
    DecisionsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayClient],
  exports: [RazorpayClient],
})
export class PaymentsModule {}
