import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { LocalityQueryDto } from './dto/locality-query.dto';
import { GeoService, LocalityResult } from './geo.service';

@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('locality')
  async locality(@Query() query: LocalityQueryDto): Promise<LocalityResult> {
    const result = await this.geo.resolveLocality(query.query);
    if (!result) {
      throw new NotFoundException('area not found');
    }
    return result;
  }
}
