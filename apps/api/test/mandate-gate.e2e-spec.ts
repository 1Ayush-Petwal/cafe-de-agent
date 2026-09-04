import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CafeTable } from '../src/entities/cafe-table.entity';
import { Cafe } from '../src/entities/cafe.entity';
import { Slot } from '../src/entities/slot.entity';
import { createTestApp, truncateAll } from './utils/test-app';

const SLOT_PRICE_MINOR = 4000;

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken as string;
}

interface GateFixture {
  cafeId: string;
  tableId: string;
  slotIds: string[];
  slotTimes: Date[];
}

/**
 * A café with `n` slots on the same table, each a day apart — well outside
 * the 10-hour booking-window rule (issue #17), so one user can hold and
 * confirm several of them without that unrelated rule interfering with the
 * mandate gate under test.
 */
async function seedGateFixture(app: INestApplication, n: number): Promise<GateFixture> {
  const dataSource = app.get(DataSource);
  const cafeRepo = dataSource.getRepository(Cafe);
  const tableRepo = dataSource.getRepository(CafeTable);
  const slotRepo = dataSource.getRepository(Slot);

  const cafe = await cafeRepo.save(cafeRepo.create({ name: 'Gate Café', area: 'Hauz Khas', description: 'fixture' }));
  const table = await tableRepo.save(tableRepo.create({ cafeId: cafe.id, label: 'T1', capacity: 2 }));

  const slotTimes: Date[] = [];
  const slotIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const slotTime = new Date(Date.UTC(2026, 8, 10, 9, 0, 0) + i * 24 * 60 * 60 * 1000);
    const slot = await slotRepo.save(slotRepo.create({ cafeId: cafe.id, slotTime, priceMinor: SLOT_PRICE_MINOR }));
    slotTimes.push(slotTime);
    slotIds.push(slot.id);
  }

  return { cafeId: cafe.id, tableId: table.id, slotIds, slotTimes };
}

const WIDE_WINDOW = {
  windowStart: '2026-09-01T00:00:00.000Z',
  windowEnd: '2026-10-01T00:00:00.000Z',
};

async function grantMandate(
  app: INestApplication,
  token: string,
  overrides: Partial<{
    maxPerBookingMinor: number;
    maxTotalMinor: number;
    maxBookings: number;
    allowedLocalities: string[];
    windowStart: string;
    windowEnd: string;
  }> = {},
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/mandates')
    .set('Authorization', `Bearer ${token}`)
    .send({
      maxPerBookingMinor: SLOT_PRICE_MINOR,
      maxTotalMinor: SLOT_PRICE_MINOR * 10,
      maxBookings: 10,
      allowedLocalities: ['Hauz Khas'],
      ...WIDE_WINDOW,
      ...overrides,
    })
    .expect(201);
  return res.body.id as string;
}

async function holdAndConfirm(
  app: INestApplication,
  token: string,
  fixture: GateFixture,
  slotIndex: number,
  mandateId?: string,
): Promise<request.Response> {
  const holdRes = await request(app.getHttpServer())
    .post('/reservations/hold')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId: fixture.tableId, slotId: fixture.slotIds[slotIndex] })
    .expect(201);

  return request(app.getHttpServer())
    .post('/reservations/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({
      holdId: holdRes.body.holdId,
      tableId: fixture.tableId,
      slotId: fixture.slotIds[slotIndex],
      ...(mandateId ? { mandateId } : {}),
    });
}

/**
 * Issue #5 (PRD area B): the two enforcement points the mandate needs to be
 * more than an artifact — a read-only advisory preview before any payment
 * intent, and the binding conditional-UPDATE gate inside `executeConfirm`'s
 * own transaction. Issue #4 already covers grant/read/revoke lifecycle.
 */
describe('Mandate gate: preview and atomic binding (e2e)', () => {
  let app: INestApplication;
  let fixture: GateFixture;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    fixture = await seedGateFixture(app, 10);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('previewMandate — advisory, read-only', () => {
    it('allows an affordable, in-bounds candidate and mutates nothing', async () => {
      const token = await signup(app, 'preview-allow@example.com');
      const mandateId = await grantMandate(app, token);

      const res = await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
        .expect(201);
      expect(res.body).toEqual({ verdict: 'ALLOW' });

      const status = await request(app.getHttpServer())
        .get(`/mandates/${mandateId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(status.body.consumedMinor).toBe(0);
      expect(status.body.consumedBookings).toBe(0);
    });

    it('denies a per-booking ceiling breach and mutates nothing', async () => {
      const token = await signup(app, 'preview-perbooking@example.com');
      const mandateId = await grantMandate(app, token, { maxPerBookingMinor: SLOT_PRICE_MINOR - 1 });

      const res = await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
        .expect(201);
      expect(res.body).toEqual({ verdict: 'DENY', reason: 'per_booking_ceiling_exceeded' });

      const status = await request(app.getHttpServer())
        .get(`/mandates/${mandateId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(status.body.consumedMinor).toBe(0);
      expect(status.body.consumedBookings).toBe(0);
    });

    it('denies a total-ceiling breach once headroom is already spent', async () => {
      const token = await signup(app, 'preview-total@example.com');
      const mandateId = await grantMandate(app, token, {
        maxPerBookingMinor: SLOT_PRICE_MINOR,
        maxTotalMinor: SLOT_PRICE_MINOR,
        maxBookings: 5,
      });

      await holdAndConfirm(app, token, fixture, 0, mandateId).then((r) => expect(r.status).toBe(201));

      const res = await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[1] })
        .expect(201);
      expect(res.body).toEqual({ verdict: 'DENY', reason: 'total_ceiling_exceeded' });
    });

    it('denies once the booking count is exhausted', async () => {
      const token = await signup(app, 'preview-exhausted@example.com');
      const mandateId = await grantMandate(app, token, { maxBookings: 1 });

      await holdAndConfirm(app, token, fixture, 0, mandateId).then((r) => expect(r.status).toBe(201));

      const res = await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[1] })
        .expect(201);
      expect(res.body).toEqual({ verdict: 'DENY', reason: 'bookings_exhausted' });
    });

    it('denies a locality outside the allowed list', async () => {
      const token = await signup(app, 'preview-locality@example.com');
      const mandateId = await grantMandate(app, token, { allowedLocalities: ['GK-II'] });

      const res = await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
        .expect(201);
      expect(res.body).toEqual({ verdict: 'DENY', reason: 'locality_mismatch' });
    });

    it('denies a slot time outside the mandate window', async () => {
      const token = await signup(app, 'preview-window@example.com');
      const mandateId = await grantMandate(app, token, {
        windowStart: '2030-01-01T00:00:00.000Z',
        windowEnd: '2030-01-02T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
        .expect(201);
      expect(res.body).toEqual({ verdict: 'DENY', reason: 'window_mismatch' });
    });

    it('denies every action under an expired mandate', async () => {
      const token = await signup(app, 'preview-expired@example.com');
      const mandateId = await grantMandate(app, token, {
        windowStart: '2020-01-01T00:00:00.000Z',
        windowEnd: '2020-01-02T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
        .expect(201);
      expect(res.body).toEqual({ verdict: 'DENY', reason: 'expired' });
    });

    it('denies every action under a revoked mandate', async () => {
      const token = await signup(app, 'preview-revoked@example.com');
      const mandateId = await grantMandate(app, token);
      await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/revoke`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
        .expect(201);
      expect(res.body).toEqual({ verdict: 'DENY', reason: 'revoked' });
    });

    it('an abandoned checkout — held then never confirmed — consumes no budget', async () => {
      const token = await signup(app, 'abandoned@example.com');
      const mandateId = await grantMandate(app, token);

      await request(app.getHttpServer())
        .post('/reservations/hold')
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/mandates/${mandateId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId: fixture.slotIds[0] })
        .expect(201);

      const status = await request(app.getHttpServer())
        .get(`/mandates/${mandateId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(status.body.consumedMinor).toBe(0);
      expect(status.body.consumedBookings).toBe(0);
    });
  });

  describe('authorizeAndConsume — binding, inside the confirm transaction', () => {
    it('allows and consumes atomically on a compliant confirm', async () => {
      const token = await signup(app, 'confirm-allow@example.com');
      const mandateId = await grantMandate(app, token);

      const res = await holdAndConfirm(app, token, fixture, 0, mandateId);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('booked');

      const status = await request(app.getHttpServer())
        .get(`/mandates/${mandateId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(status.body.consumedMinor).toBe(SLOT_PRICE_MINOR);
      expect(status.body.consumedBookings).toBe(1);
    });

    it('a denied confirm rolls back completely: no reservation, no payment, no consumption', async () => {
      const token = await signup(app, 'confirm-deny@example.com');
      const mandateId = await grantMandate(app, token, { maxPerBookingMinor: SLOT_PRICE_MINOR - 1 });

      const res = await holdAndConfirm(app, token, fixture, 0, mandateId);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('per_booking_ceiling_exceeded');
      expect(res.body.verdict).toBe('DENY');

      const mine = await request(app.getHttpServer())
        .get('/reservations/mine')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(mine.body).toHaveLength(0);

      const status = await request(app.getHttpServer())
        .get(`/mandates/${mandateId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(status.body.consumedMinor).toBe(0);
      expect(status.body.consumedBookings).toBe(0);
    });

    it(
      'parallel confirms against a mandate with headroom for fewer than all of them ' +
        'never breach the ceiling, and exactly the affordable number succeed',
      async () => {
        const CONCURRENCY = 10;
        const AFFORDABLE = 4;
        const token = await signup(app, 'concurrent@example.com');
        const mandateId = await grantMandate(app, token, {
          maxPerBookingMinor: SLOT_PRICE_MINOR,
          maxTotalMinor: SLOT_PRICE_MINOR * CONCURRENCY,
          maxBookings: AFFORDABLE,
        });

        const holds = await Promise.all(
          Array.from({ length: CONCURRENCY }, (_, i) =>
            request(app.getHttpServer())
              .post('/reservations/hold')
              .set('Authorization', `Bearer ${token}`)
              .send({ tableId: fixture.tableId, slotId: fixture.slotIds[i] })
              .expect(201)
              .then((r) => r.body.holdId as string),
          ),
        );

        const results = await Promise.allSettled(
          holds.map((holdId, i) =>
            request(app.getHttpServer())
              .post('/reservations/confirm')
              .set('Authorization', `Bearer ${token}`)
              .send({ holdId, tableId: fixture.tableId, slotId: fixture.slotIds[i], mandateId })
              .then((r) => ({ status: r.status, reason: r.body.reason as string | undefined })),
          ),
        );
        const settled = results.map((r) => (r.status === 'fulfilled' ? r.value : { status: -1, reason: undefined }));

        const won = settled.filter((r) => r.status === 201);
        const lost = settled.filter((r) => r.status === 403);
        expect(won).toHaveLength(AFFORDABLE);
        expect(lost).toHaveLength(CONCURRENCY - AFFORDABLE);
        expect(lost.every((r) => r.reason === 'bookings_exhausted')).toBe(true);

        const mine = await request(app.getHttpServer())
          .get('/reservations/mine')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect(mine.body).toHaveLength(AFFORDABLE);

        const status = await request(app.getHttpServer())
          .get(`/mandates/${mandateId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect(status.body.consumedBookings).toBe(AFFORDABLE);
        expect(status.body.consumedMinor).toBe(AFFORDABLE * SLOT_PRICE_MINOR);
      },
    );

    it('a confirm with no mandateId is unaffected by any mandate (direct booking stays unbounded)', async () => {
      const token = await signup(app, 'unbounded@example.com');
      await grantMandate(app, token, { maxPerBookingMinor: 1, maxTotalMinor: 1, maxBookings: 1 });

      const res = await holdAndConfirm(app, token, fixture, 0);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('booked');
    });
  });
});
