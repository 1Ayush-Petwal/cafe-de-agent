import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, Fixture, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken;
}

describe('Booking tracer bullet (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    fixture = await seedFixture(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const dateOnly = () => fixture.slotTime.toISOString().slice(0, 10);

  it('lists seeded cafés', async () => {
    const res = await request(app.getHttpServer()).get('/cafes').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: fixture.cafeId, name: 'Test Café' });
  });

  it('shows a café availability grid for a date', async () => {
    const res = await request(app.getHttpServer())
      .get(`/cafes/${fixture.cafeId}/availability`)
      .query({ date: dateOnly() })
      .expect(200);

    expect(res.body).toHaveLength(2);
    const table = res.body.find((t: { tableId: string }) => t.tableId === fixture.tableId);
    expect(table.slots).toHaveLength(1);
    expect(table.slots[0]).toMatchObject({ slotId: fixture.slotId, available: true });
  });

  it('books a free table+slot, shows it in my reservations, and marks it unavailable to others', async () => {
    const aliceToken = await signup(app, 'alice@example.com');
    const bobToken = await signup(app, 'bob@example.com');

    const bookRes = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);
    expect(bookRes.body).toMatchObject({
      tableId: fixture.tableId,
      slotId: fixture.slotId,
      status: 'booked',
    });

    const mine = await request(app.getHttpServer())
      .get('/reservations/mine')
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].id).toBe(bookRes.body.id);

    // Bob sees the same slot as unavailable now.
    const availability = await request(app.getHttpServer())
      .get(`/cafes/${fixture.cafeId}/availability`)
      .query({ date: dateOnly() })
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);
    const table = availability.body.find((t: { tableId: string }) => t.tableId === fixture.tableId);
    expect(table.slots[0]).toMatchObject({ slotId: fixture.slotId, available: false });

    // Bob cannot book the same table+slot (naive check-then-insert still catches the non-racy case).
    await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(409);
  });

  it('frees the slot when the reservation is cancelled', async () => {
    const aliceToken = await signup(app, 'alice@example.com');

    const bookRes = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/reservations/${bookRes.body.id}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);

    const availability = await request(app.getHttpServer())
      .get(`/cafes/${fixture.cafeId}/availability`)
      .query({ date: dateOnly() })
      .expect(200);
    const table = availability.body.find((t: { tableId: string }) => t.tableId === fixture.tableId);
    expect(table.slots[0]).toMatchObject({ slotId: fixture.slotId, available: true });

    const mine = await request(app.getHttpServer())
      .get('/reservations/mine')
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
    expect(mine.body[0].status).toBe('cancelled');
  });

  it('prevents a customer from viewing or cancelling another customer\'s reservation', async () => {
    const aliceToken = await signup(app, 'alice@example.com');
    const bobToken = await signup(app, 'bob@example.com');

    const bookRes = await request(app.getHttpServer())
      .post('/reservations')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ tableId: fixture.tableId, slotId: fixture.slotId })
      .expect(201);

    const bobsView = await request(app.getHttpServer())
      .get('/reservations/mine')
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);
    expect(bobsView.body).toHaveLength(0);

    await request(app.getHttpServer())
      .delete(`/reservations/${bookRes.body.id}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(403);

    // Still booked — Bob's failed cancel attempt had no effect.
    const stillMine = await request(app.getHttpServer())
      .get('/reservations/mine')
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);
    expect(stillMine.body[0].status).toBe('booked');
  });
});
