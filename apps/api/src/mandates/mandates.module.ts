import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CafeTable } from '../entities/cafe-table.entity';
import { Mandate } from '../entities/mandate.entity';
import { Slot } from '../entities/slot.entity';
import { MandatesController } from './mandates.controller';
import { MandatesService } from './mandates.service';

@Module({
  imports: [TypeOrmModule.forFeature([Mandate, CafeTable, Slot])],
  controllers: [MandatesController],
  providers: [MandatesService],
  exports: [MandatesService],
})
export class MandatesModule {}
