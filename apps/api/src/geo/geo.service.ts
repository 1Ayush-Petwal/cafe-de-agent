import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { NominatimClient } from './nominatim.client';

// left,top,right,bottom (lon,lat) — a box comfortably covering the Delhi NCR
// region, per the PRD's "queries are bounded to a Delhi bounding box".
const DELHI_VIEWBOX = '76.70,28.90,77.45,28.35';

// Localities don't move: a long TTL means most searches for the same place
// hit Redis, not Nominatim, keeping well under its 1 req/sec policy.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface LocalityResult {
  lat: number;
  lon: number;
  displayName: string;
}

@Injectable()
export class GeoService {
  constructor(
    private readonly nominatim: NominatimClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private cacheKey(query: string): string {
    return `geo:locality:${query.trim().toLowerCase()}`;
  }

  async resolveLocality(query: string): Promise<LocalityResult | null> {
    const key = this.cacheKey(query);
    const cached = await this.redis.get(key);
    if (cached) {
      return JSON.parse(cached) as LocalityResult;
    }

    const results = await this.nominatim.search(query, DELHI_VIEWBOX);
    const first = results[0];
    if (!first) {
      return null;
    }

    const resolved: LocalityResult = { lat: first.lat, lon: first.lon, displayName: first.displayName };
    await this.redis.set(key, JSON.stringify(resolved), 'EX', CACHE_TTL_SECONDS);
    return resolved;
  }
}
