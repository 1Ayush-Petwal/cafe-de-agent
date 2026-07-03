import { INestApplication } from '@nestjs/common';
import request from 'supertest';
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
 * Issue #8: owner-role JWT + owner-only endpoints scoped to cafés the
 * owner actually owns. Covers the four acceptance criteria: dashboard
 * access gated by role, table/slot-grid management scoped to one's own
 * café (rejected against another owner's), viewing a day's bookings, and
 * an out-of-service table immediately showing unavailable.
 */
describe('Owner manages the floor (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a customer from every owner endpoint', async () => {
    const customer = await signup(app, 'customer@example.com', 'customer');
    await request(app.getHttpServer())
      .get('/owner/cafes')
      .set('Authorization', `Bearer ${customer}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/owner/cafes')
      .set('Authorization', `Bearer ${customer}`)
      .send({ name: 'Nope Café', area: 'CP' })
      .expect(403);
  });

  it('lets an owner create a café and manage its tables', async () => {
    const owner = await signup(app, 'owner@example.com', 'owner');

    const cafeRes = await request(app.getHttpServer())
      .post('/owner/cafes')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Owner Café', area: 'Hauz Khas' })
      .expect(201);
    const cafeId = cafeRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/owner/cafes')
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(cafeId);

    const tableRes = await request(app.getHttpServer())
      .post(`/owner/cafes/${cafeId}/tables`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ label: 'T1', capacity: 4 })
      .expect(201);
    expect(tableRes.body).toMatchObject({ label: 'T1', capacity: 4, inService: true });

    const updateRes = await request(app.getHttpServer())
      .patch(`/owner/cafes/${cafeId}/tables/${tableRes.body.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ capacity: 6 })
      .expect(200);
    expect(updateRes.body).toMatchObject({ capacity: 6 });
  });

  it("rejects managing another owner's café", async () => {
    const ownerA = await signup(app, 'ownera@example.com', 'owner');
    const ownerB = await signup(app, 'ownerb@example.com', 'owner');

    const cafeRes = await request(app.getHttpServer())
      .post('/owner/cafes')
      .set('Authorization', `Bearer ${ownerA}`)
      .send({ name: "A's Café", area: 'CP' })
      .expect(201);
    const cafeId = cafeRes.body.id;

    await request(app.getHttpServer())
      .post(`/owner/cafes/${cafeId}/tables`)
      .set('Authorization', `Bearer ${ownerB}`)
      .send({ label: 'T1', capacity: 2 })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/owner/cafes/${cafeId}/slots/generate`)
      .set('Authorization', `Bearer ${ownerB}`)
      .send({ startDate: '2026-08-01' })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/owner/cafes/${cafeId}/bookings`)
      .set('Authorization', `Bearer ${ownerB}`)
      .query({ date: '2026-08-01' })
      .expect(403);
  });

  it('generates a daily slot grid and reflects a chosen day\'s bookings', async () => {
    const owner = await signup(app, 'owner2@example.com', 'owner');
    const customer = await signup(app, 'diner@example.com', 'customer');

    const cafeRes = await request(app.getHttpServer())
      .post('/owner/cafes')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Grid Café', area: 'CP' })
      .expect(201);
    const cafeId = cafeRes.body.id;

    const tableRes = await request(app.getHttpServer())
      .post(`/owner/cafes/${cafeId}/tables`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ label: 'T1', capacity: 2 })
      .expect(201);
    const tableId = tableRes.body.id;

    const genRes = await request(app.getHttpServer())
      .post(`/owner/cafes/${cafeId}/slots/generate`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ startDate: '2026-08-01', days: 1, openHour: 9, closeHour: 12, turnTimeMinutes: 60 })
      .expect(201);
    expect(genRes.body).toHaveLength(3);

    // Regenerating the same range is idempotent (no duplicates).
    const regenRes = await request(app.getHttpServer())
      .post(`/owner/cafes/${cafeId}/slots/generate`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ startDate: '2026-08-01', days: 1, openHour: 9, closeHour: 12, turnTimeMinutes: 60 })
      .expect(201);
    expect(regenRes.body).toHaveLength(0);

    const availability = await request(app.getHttpServer())
      .get(`/cafes/${cafeId}/availability`)
      .query({ date: '2026-08-01' })
      .set('Authorization', `Bearer ${customer}`)
      .expect(200);
    const slotId = availability.body[0].slots[0].slotId;

    const hold = await request(app.getHttpServer())
      .post('/reservations/hold')
      .set('Authorization', `Bearer ${customer}`)
      .send({ tableId, slotId })
      .expect(201);
    await request(app.getHttpServer())
      .post('/reservations/confirm')
      .set('Authorization', `Bearer ${customer}`)
      .send({ holdId: hold.body.holdId, tableId, slotId })
      .expect(201);

    const bookings = await request(app.getHttpServer())
      .get(`/owner/cafes/${cafeId}/bookings`)
      .set('Authorization', `Bearer ${owner}`)
      .query({ date: '2026-08-01' })
      .expect(200);
    expect(bookings.body).toHaveLength(1);
    expect(bookings.body[0]).toMatchObject({ tableId, slotId, status: 'booked' });
  });

  it('makes a table taken out of service immediately show unavailable', async () => {
    const owner = await signup(app, 'owner3@example.com', 'owner');
    const customer = await signup(app, 'diner2@example.com', 'customer');

    const cafeRes = await request(app.getHttpServer())
      .post('/owner/cafes')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Service Café', area: 'CP' })
      .expect(201);
    const cafeId = cafeRes.body.id;

    const tableRes = await request(app.getHttpServer())
      .post(`/owner/cafes/${cafeId}/tables`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ label: 'T1', capacity: 2 })
      .expect(201);
    const tableId = tableRes.body.id;

    await request(app.getHttpServer())
      .post(`/owner/cafes/${cafeId}/slots/generate`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ startDate: '2026-08-02', days: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/owner/cafes/${cafeId}/tables/${tableId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ inService: false })
      .expect(200);

    const availability = await request(app.getHttpServer())
      .get(`/cafes/${cafeId}/availability`)
      .query({ date: '2026-08-02' })
      .set('Authorization', `Bearer ${customer}`)
      .expect(200);
    const table = availability.body.find((t: { tableId: string }) => t.tableId === tableId);
    expect(table.slots.every((s: { available: boolean }) => s.available === false)).toBe(true);
  });
});
