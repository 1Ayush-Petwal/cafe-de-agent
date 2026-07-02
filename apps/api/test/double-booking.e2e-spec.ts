import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, Fixture, seedFixture, truncateAll } from './utils/test-app';

const CONCURRENCY = 10;

async function signupMany(app: INestApplication, n: number): Promise<string[]> {
  const tokens = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      request(app.getHttpServer())
        .post('/auth/signup')
        .send({ email: `racer${i}@example.com`, password: 'hunter2222' })
        .expect(201)
        .then((res) => res.body.accessToken as string),
    ),
  );
  return tokens;
}

/**
 * The crown-jewel M1 test (Roadmap M1 / issue #3): fire N concurrent booking
 * requests at the exact same table+slot and assert exactly one wins. Run
 * against the naive M0 path (no `strategy`, or `strategy: undefined`) this
 * reliably double-books — that failure is what justifies M1's three fixes.
 * Parametrized across all three strategies: the same race, three guards.
 */
describe('Double-booking race (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;
  let tokens: string[];

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    fixture = await seedFixture(app);
    tokens = await signupMany(app, CONCURRENCY);
  });

  afterAll(async () => {
    await app.close();
  });

  // Promise.allSettled, not Promise.all: a transient socket-level error on
  // one of N concurrent requests must not let the test move on (and the
  // next beforeEach truncate the fixture) while the other requests are
  // still in flight against the server.
  const fireConcurrentBookings = async (strategy?: string): Promise<number[]> => {
    const results = await Promise.allSettled(
      tokens.map((token) =>
        request(app.getHttpServer())
          .post('/reservations')
          .set('Authorization', `Bearer ${token}`)
          .send({ tableId: fixture.tableId, slotId: fixture.slotId, strategy })
          .then((res) => res.status),
      ),
    );
    return results.map((r) => (r.status === 'fulfilled' ? r.value : -1));
  };

  it.each(['unique', 'pessimistic', 'optimistic'] as const)(
    'strategy=%s: exactly one of %i concurrent bookings for the same table+slot wins',
    async (strategy) => {
      const statuses = await fireConcurrentBookings(strategy);
      const won = statuses.filter((s) => s === 201);
      const lost = statuses.filter((s) => s === 409);

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(CONCURRENCY - 1);
      expect(won.length + lost.length).toBe(CONCURRENCY);

      const mine = await request(app.getHttpServer())
        .get('/cafes/' + fixture.cafeId + '/availability')
        .query({ date: fixture.slotTime.toISOString().slice(0, 10) })
        .expect(200);
      const table = mine.body.find((t: { tableId: string }) => t.tableId === fixture.tableId);
      expect(table.slots[0]).toMatchObject({ slotId: fixture.slotId, available: false });
    },
  );
});
