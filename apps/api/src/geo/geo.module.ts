import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { NominatimClient } from './nominatim.client';

@Module({
  controllers: [GeoController],
  providers: [GeoService, NominatimClient],
})
export class GeoModule {}
