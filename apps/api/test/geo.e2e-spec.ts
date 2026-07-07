import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { NominatimClient } from '../src/geo/nominatim.client';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { createTestApp, truncateAll } from './utils/test-app';

/**
 * Issue #22 (PRD area D): locality geocoding. Covers the HTTP-seam
 * acceptance criteria — resolve a locality to coordinates + display name,
 * Redis cache hit skips the upstream (stubbed) call, and unknown locality
 * returns a not-found shape. The Nominatim client is stubbed via DI — the
 * established mock-gateway pattern (PaymentsService, AgentLlmClient) — so no
 * live network call ever happens in this suite.
 */
describe('Geo locality search (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  let nominatim: NominatimClient;

  beforeAll(async () => {
    app = await createTestApp();
    redis = app.get(REDIS_CLIENT);
    nominatim = app.get(NominatimClient);
  });

  beforeEach(async () => {
    await truncateAll(app);
    await redis.flushdb();
    nominatim.clearStub();
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves a locality to coordinates + display name', async () => {
    nominatim.stub([{ lat: 28.5535, lon: 77.1892, displayName: 'Hauz Khas, Delhi, India' }]);

    const res = await request(app.getHttpServer())
      .get('/geo/locality')
      .query({ query: 'Hauz Khas' })
      .expect(200);

    expect(res.body).toEqual({ lat: 28.5535, lon: 77.1892, displayName: 'Hauz Khas, Delhi, India' });
  });

  it('skips the upstream call on a cache hit', async () => {
    nominatim.stub([{ lat: 28.5535, lon: 77.1892, displayName: 'Hauz Khas, Delhi, India' }]);

    await request(app.getHttpServer()).get('/geo/locality').query({ query: 'Hauz Khas' }).expect(200);

    // Flip the stub — if the second request hit the upstream again it would
    // now return this different result, proving the cache was actually used.
    nominatim.stub([{ lat: 0, lon: 0, displayName: 'should not be seen' }]);

    const res = await request(app.getHttpServer())
      .get('/geo/locality')
      .query({ query: 'Hauz Khas' })
      .expect(200);

    expect(res.body).toEqual({ lat: 28.5535, lon: 77.1892, displayName: 'Hauz Khas, Delhi, India' });
  });

  it('returns a not-found shape for an unknown locality', async () => {
    nominatim.stub([]);

    const res = await request(app.getHttpServer())
      .get('/geo/locality')
      .query({ query: 'Nowhereville' })
      .expect(404);

    expect(res.body.message).toMatch(/not found/i);
  });

  it('is case/whitespace-insensitive for cache lookups', async () => {
    nominatim.stub([{ lat: 28.5535, lon: 77.1892, displayName: 'Hauz Khas, Delhi, India' }]);
    await request(app.getHttpServer()).get('/geo/locality').query({ query: '  Hauz Khas  ' }).expect(200);

    nominatim.stub([{ lat: 0, lon: 0, displayName: 'should not be seen' }]);
    const res = await request(app.getHttpServer())
      .get('/geo/locality')
      .query({ query: 'hauz khas' })
      .expect(200);

    expect(res.body.displayName).toEqual('Hauz Khas, Delhi, India');
  });

  it('rejects a missing query param', async () => {
    await request(app.getHttpServer()).get('/geo/locality').expect(400);
  });
});
