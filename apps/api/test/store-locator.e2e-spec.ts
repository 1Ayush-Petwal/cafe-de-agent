import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Cafe } from '../src/entities/cafe.entity';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import { createTestApp, truncateAll } from './utils/test-app';

async function signup(
  app: INestApplication,
  email: string,
  role?: 'customer' | 'owner',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222', ...(role ? { role } : {}) })
    .expect(201);
  return res.body.accessToken;
}

/**
 * Issue #18 (PRD area D): store-locator café list. Covers the HTTP-seam
 * acceptance criteria — new locator fields present in responses, filtering by
 * region and cuisine, rating sort, that filters apply post-cache-read (so the
 * cached list is unaffected by filter params), and that an owner can set
 * cuisines from the dashboard.
 */
describe('Store locator café list (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    redis = app.get(REDIS_CLIENT);
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAll(app);
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedCafes(): Promise<void> {
    const repo = dataSource.getRepository(Cafe);
    await repo.save([
      repo.create({
        name: 'Aleph Coffee',
        area: 'Connaught Place',
        latitude: 28.63,
        longitude: 77.21,
        region: 'delhi',
        cuisines: ['Italian', 'Continental'],
        rating: 4.1,
        ratingCount: 120,
      }),
      repo.create({
        name: 'Beta Brews',
        area: 'Hauz Khas',
        latitude: 28.55,
        longitude: 77.19,
        region: 'delhi',
        cuisines: ['Italian', 'Asian'],
        rating: 4.8,
        ratingCount: 300,
      }),
      repo.create({
        name: 'Gamma Grinds',
        area: 'MG Road',
        latitude: 28.47,
        longitude: 77.03,
        region: 'gurgaon',
        cuisines: ['Asian'],
        rating: 4.5,
        ratingCount: 90,
      }),
    ]);
  }

  it('returns the new locator fields in the café list', async () => {
    await seedCafes();
    const res = await request(app.getHttpServer()).get('/cafes').expect(200);
    expect(res.body).toHaveLength(3);
    const aleph = res.body.find((c: { name: string }) => c.name === 'Aleph Coffee');
    expect(aleph).toMatchObject({
      latitude: 28.63,
      longitude: 77.21,
      region: 'delhi',
      cuisines: ['Italian', 'Continental'],
      rating: 4.1,
      ratingCount: 120,
    });
    expect(aleph.openingHour).toBeDefined();
    expect(aleph.closingHour).toBeDefined();
  });

  it('filters by region', async () => {
    await seedCafes();
    const res = await request(app.getHttpServer()).get('/cafes').query({ region: 'delhi' }).expect(200);
    expect(res.body.map((c: { name: string }) => c.name).sort()).toEqual([
      'Aleph Coffee',
      'Beta Brews',
    ]);
  });

  it('filters by cuisine', async () => {
    await seedCafes();
    const res = await request(app.getHttpServer())
      .get('/cafes')
      .query({ cuisine: 'Italian' })
      .expect(200);
    expect(res.body.map((c: { name: string }) => c.name).sort()).toEqual([
      'Aleph Coffee',
      'Beta Brews',
    ]);
  });

  it('sorts by rating (best first) and combines with a filter', async () => {
    await seedCafes();
    const res = await request(app.getHttpServer())
      .get('/cafes')
      .query({ region: 'delhi', cuisine: 'Italian', sort: 'rating' })
      .expect(200);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(['Beta Brews', 'Aleph Coffee']);
  });

  it('applies filters post-cache-read: the cached list stays the full unfiltered set', async () => {
    await seedCafes();
    // Prime the cache with a filtered request...
    await request(app.getHttpServer()).get('/cafes').query({ region: 'delhi' }).expect(200);
    // ...the cache key holds the FULL list, not the filtered subset.
    const cached = JSON.parse((await redis.get('cafes:list')) as string);
    expect(cached).toHaveLength(3);
    // A different filter against the same cache still returns the right subset.
    const gurgaon = await request(app.getHttpServer())
      .get('/cafes')
      .query({ region: 'gurgaon' })
      .expect(200);
    expect(gurgaon.body.map((c: { name: string }) => c.name)).toEqual(['Gamma Grinds']);
  });

  it('lets an owner set cuisines on their café, reflected in the public list', async () => {
    const owner = await signup(app, 'locator-owner@example.com', 'owner');
    const created = await request(app.getHttpServer())
      .post('/owner/cafes')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Owner Locator Café', area: 'Saket', latitude: 28.52, longitude: 77.2 })
      .expect(201);
    const cafeId = created.body.id;

    const updated = await request(app.getHttpServer())
      .patch(`/owner/cafes/${cafeId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ cuisines: ['Italian', 'Coffee'] })
      .expect(200);
    expect(updated.body.cuisines).toEqual(['Italian', 'Coffee']);

    // Public list now filters this café in under its new cuisine.
    const res = await request(app.getHttpServer())
      .get('/cafes')
      .query({ cuisine: 'Coffee' })
      .expect(200);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(['Owner Locator Café']);
  });
});
