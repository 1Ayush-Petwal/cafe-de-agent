import { Controller, Get, Param, Query } from '@nestjs/common';
import { Cafe } from '../entities/cafe.entity';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { CafesService, TableAvailability } from './cafes.service';

@Controller('cafes')
export class CafesController {
  constructor(private readonly cafes: CafesService) {}

  @Get()
  findAll(): Promise<Cafe[]> {
    return this.cafes.findAll();
  }

  @Get(':id/availability')
  getAvailability(
    @Param('id') id: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<TableAvailability[]> {
    return this.cafes.getAvailability(id, query.date);
  }
}
