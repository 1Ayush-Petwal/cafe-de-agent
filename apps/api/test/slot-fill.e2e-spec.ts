import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AgentLlmClient, ScriptedTurn } from '../src/agent/llm/agent-llm.client';
import { AgentWorkerService } from '../src/agent/agent-worker.service';
import { LlmTurn } from '../src/agent/llm/agent-llm.types';
import { CafeTable } from '../src/entities/cafe-table.entity';
import { Cafe } from '../src/entities/cafe.entity';
import { ReservationStatus } from '../src/entities/reservation-status.enum';
import { Reservation } from '../src/entities/reservation.entity';
import { Slot } from '../src/entities/slot.entity';
import { User } from '../src/entities/user.entity';
import { createTestApp, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken as string;
}

/** Same weekday every time, 7 days apart — dayOfWeek is what the demand-score bucket keys on. */
function daysBefore(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function slotTimeAt(dateOnly: string, hourUtc: number): Date {
  return new Date(`${dateOnly}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`);
}

const FUTURE_DATE = '2026-09-10';
const PRICE_MINOR = 10000;

interface DemandFixture {
  cafeId: string;
  tableId: string;
  historyUserId: string;
}

/**
 * A café with one table and a controllable history: `bookedPastWeeks` of the
 * `pastWeeks` prior instances of `hourUtc` on the same weekday get a real
 * BOOKED reservation, giving an exact fill rate of
 * `bookedPastWeeks / pastWeeks` for that (café, weekday, hour) bucket.
 */
async function seedDemandFixture(
  app: INestApplication,
  opts: { cafeName: string; maxDiscountMinor?: number; hourUtc: number; pastWeeks: number; bookedPastWeeks: number },
): Promise<DemandFixture> {
  const dataSource = app.get(DataSource);
  const cafeRepo = dataSource.getRepository(Cafe);
  const tableRepo = dataSource.getRepository(CafeTable);
  const slotRepo = dataSource.getRepository(Slot);
  const userRepo = dataSource.getRepository(User);
  const reservationRepo = dataSource.getRepository(Reservation);

  const cafe = await cafeRepo.save(
    cafeRepo.create({
      name: opts.cafeName,
      area: 'Hauz Khas',
      description: 'fixture',
      ...(opts.maxDiscountMinor !== undefined ? { maxDiscountMinor: opts.maxDiscountMinor } : {}),
    }),
  );
  const table = await tableRepo.save(tableRepo.create({ cafeId: cafe.id, label: 'T1', capacity: 2 }));
  const user = await userRepo.save(
    userRepo.create({ email: `${opts.cafeName.replace(/\s+/g, '-').toLowerCase()}@history.local`, passwordHash: 'x' }),
  );

  for (let week = 1; week <= opts.pastWeeks; week++) {
    const pastDate = daysBefore(FUTURE_DATE, week * 7);
    const slot = await slotRepo.save(
      slotRepo.create({ cafeId: cafe.id, slotTime: slotTimeAt(pastDate, opts.hourUtc), priceMinor: PRICE_MINOR }),
    );
    if (week <= opts.bookedPastWeeks) {
      await reservationRepo.save(
        reservationRepo.create({
          userId: user.id,
          tableId: table.id,
          slotId: slot.id,
          status: ReservationStatus.BOOKED,
        }),
      );
    }
  }

  return { cafeId: cafe.id, tableId: table.id, historyUserId: user.id };
}

async function addFutureSlot(app: INestApplication, cafeId: string, hourUtc: number): Promise<string> {
  const dataSource = app.get(DataSource);
  const slotRepo = dataSource.getRepository(Slot);
  const slot = await slotRepo.save(
    slotRepo.create({ cafeId, slotTime: slotTimeAt(FUTURE_DATE, hourUtc), priceMinor: PRICE_MINOR }),
  );
  return slot.id;
}

function findSlot(body: Array<{ tableId: string; slots: Array<Record<string, unknown>> }>, tableId: string, slotId: string) {
  const table = body.find((t) => t.tableId === tableId);
  return table?.slots.find((s) => s.slotId === slotId);
}

async function seedManyColdSlots(
  app: INestApplication,
): Promise<{ cafeId: string; tableId: string; slotIds: string[] }> {
  const fixture = await seedDemandFixture(app, {
    cafeName: 'Alternatives Café',
    hourUtc: 20,
    pastWeeks: 3,
    bookedPastWeeks: 0,
  });
  const slotIds = [
    await addFutureSlot(app, fixture.cafeId, 12),
    await addFutureSlot(app, fixture.cafeId, 15),
    await addFutureSlot(app, fixture.cafeId, 20),
    await addFutureSlot(app, fixture.cafeId, 21),
  ];
  return { cafeId: fixture.cafeId, tableId: fixture.tableId, slotIds };
}

/**
 * Issue #10 (PRD area F): "Cold slots get nudged" — demand scoring, the
 * bounded discount, and the two-per-request mandate-screened alternatives.
 */
describe('Slot-fill: demand score, discount, and alternatives (e2e)', () => {
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

  describe('demand score and bounded discount', () => {
    it('scores a slot with no booking history cold, and one with a full history hot — and only discounts the cold one', async () => {
      const fixture = await seedDemandFixture(app, {
        cafeName: 'Spread Café',
        hourUtc: 20,
        pastWeeks: 5,
        bookedPastWeeks: 0,
      });
      const coldSlotId = await addFutureSlot(app, fixture.cafeId, 20);

      // A second, unrelated hour bucket at the same café with a full history.
      const dataSource = app.get(DataSource);
      const slotRepo = dataSource.getRepository(Slot);
      const reservationRepo = dataSource.getRepository(Reservation);
      for (let week = 1; week <= 5; week++) {
        const pastDate = daysBefore(FUTURE_DATE, week * 7);
        const slot = await slotRepo.save(
          slotRepo.create({ cafeId: fixture.cafeId, slotTime: slotTimeAt(pastDate, 12), priceMinor: PRICE_MINOR }),
        );
        await reservationRepo.save(
          reservationRepo.create({
            userId: fixture.historyUserId,
            tableId: fixture.tableId,
            slotId: slot.id,
            status: ReservationStatus.BOOKED,
          }),
        );
      }
      const hotSlotId = await addFutureSlot(app, fixture.cafeId, 12);

      const res = await request(app.getHttpServer())
        .get(`/cafes/${fixture.cafeId}/availability`)
        .query({ date: FUTURE_DATE })
        .expect(200);

      const cold = findSlot(res.body, fixture.tableId, coldSlotId)!;
      const hot = findSlot(res.body, fixture.tableId, hotSlotId)!;

      expect(cold.demandScore).toBeCloseTo(0, 10);
      expect(cold.cold).toBe(true);
      expect(cold.discountedPriceMinor).toBe(PRICE_MINOR - 2000); // min(20% of 10000, default floor 8000)

      expect(hot.demandScore).toBeCloseTo(0.7, 10);
      expect(hot.cold).toBe(false);
      expect(hot.discountedPriceMinor).toBe(PRICE_MINOR); // hot is never discounted, at any size

      expect(cold.demandScore).not.toBe(hot.demandScore);
    });

    it("caps the discount at the café's floor when it is tighter than the 20% fraction", async () => {
      const fixture = await seedDemandFixture(app, {
        cafeName: 'Floored Café',
        maxDiscountMinor: 300,
        hourUtc: 20,
        pastWeeks: 5,
        bookedPastWeeks: 0,
      });
      const slotId = await addFutureSlot(app, fixture.cafeId, 20);

      const res = await request(app.getHttpServer())
        .get(`/cafes/${fixture.cafeId}/availability`)
        .query({ date: FUTURE_DATE })
        .expect(200);

      const slot = findSlot(res.body, fixture.tableId, slotId)!;
      expect(slot.cold).toBe(true);
      expect(slot.discountedPriceMinor).toBe(PRICE_MINOR - 300); // 20% (2000) capped down to the floor (300)
    });

    it('blends live hold pressure into the score, flipping an otherwise-cold slot hot the instant it is held', async () => {
      const fixture = await seedDemandFixture(app, {
        cafeName: 'Pressure Café',
        hourUtc: 20,
        pastWeeks: 5,
        bookedPastWeeks: 1, // fillRate = 0.2 -> 0.7*0.2 = 0.14, alone still cold
      });
      const slotId = await addFutureSlot(app, fixture.cafeId, 20);

      const before = await request(app.getHttpServer())
        .get(`/cafes/${fixture.cafeId}/availability`)
        .query({ date: FUTURE_DATE })
        .expect(200);
      const beforeSlot = findSlot(before.body, fixture.tableId, slotId)!;
      expect(beforeSlot.demandScore).toBeCloseTo(0.14, 10);
      expect(beforeSlot.cold).toBe(true);
      expect(beforeSlot.discountedPriceMinor).toBe(PRICE_MINOR - 2000);

      const token = await signup(app, 'pressure-buyer@example.com');
      await request(app.getHttpServer())
        .post('/reservations/hold')
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: fixture.tableId, slotId })
        .expect(201);

      const after = await request(app.getHttpServer())
        .get(`/cafes/${fixture.cafeId}/availability`)
        .query({ date: FUTURE_DATE })
        .expect(200);
      const afterSlot = findSlot(after.body, fixture.tableId, slotId)!;
      expect(afterSlot.demandScore).toBeCloseTo(0.44, 10); // 0.14 + 0.3 (fully held) = 0.44
      expect(afterSlot.cold).toBe(false);
      expect(afterSlot.discountedPriceMinor).toBe(PRICE_MINOR);
      expect(afterSlot.available).toBe(false);
    });
  });

  describe('alternatives: at most two, mandate-screened', () => {
    it('offers at most two alternatives, excluding the requested slot', async () => {
      const { cafeId, slotIds } = await seedManyColdSlots(app);
      const token = await signup(app, 'buyer@example.com');

      const res = await request(app.getHttpServer())
        .get(`/cafes/${cafeId}/alternatives`)
        .set('Authorization', `Bearer ${token}`)
        .query({ date: FUTURE_DATE, excludeSlotId: slotIds[0] })
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body.every((a: { slotId: string }) => a.slotId !== slotIds[0])).toBe(true);
    });

    it('filters out every alternative the mandate would refuse', async () => {
      const { cafeId, slotIds } = await seedManyColdSlots(app);
      const token = await signup(app, 'mandate-buyer@example.com');

      // A window that ends before FUTURE_DATE: every candidate on FUTURE_DATE fails window_mismatch.
      const mandateRes = await request(app.getHttpServer())
        .post('/mandates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          maxPerBookingMinor: PRICE_MINOR,
          maxTotalMinor: PRICE_MINOR * 10,
          maxBookings: 10,
          allowedLocalities: ['Hauz Khas'],
          windowStart: '2026-01-01T00:00:00.000Z',
          windowEnd: '2026-01-02T00:00:00.000Z',
        })
        .expect(201);
      const mandateId = mandateRes.body.id as string;

      const withoutMandate = await request(app.getHttpServer())
        .get(`/cafes/${cafeId}/alternatives`)
        .set('Authorization', `Bearer ${token}`)
        .query({ date: FUTURE_DATE, excludeSlotId: slotIds[0] })
        .expect(200);
      expect(withoutMandate.body).toHaveLength(2);

      const withMandate = await request(app.getHttpServer())
        .get(`/cafes/${cafeId}/alternatives`)
        .set('Authorization', `Bearer ${token}`)
        .query({ date: FUTURE_DATE, excludeSlotId: slotIds[0], mandateId })
        .expect(200);
      expect(withMandate.body).toHaveLength(0);
    });
  });

  describe('agent tool wiring', () => {
    let worker: AgentWorkerService;
    let llm: AgentLlmClient;

    beforeAll(() => {
      worker = app.get(AgentWorkerService);
      llm = app.get(AgentLlmClient);
    });

    beforeEach(() => {
      llm.clearScript();
    });

    function findFunctionResponse(history: LlmTurn[], name: string): Record<string, unknown> {
      const turn = [...history].reverse().find((t) => t.functionResponse?.name === name);
      if (!turn?.functionResponse) {
        throw new Error(`No functionResponse for ${name} in history yet`);
      }
      return turn.functionResponse.response;
    }

    it('propose_alternatives returns vetted candidates the agent can offer', async () => {
      const { cafeId, tableId, slotIds } = await seedManyColdSlots(app);
      const token = await signup(app, 'agent-buyer@example.com');

      const script: ScriptedTurn[] = [
        {
          role: 'model',
          functionCall: {
            name: 'propose_alternatives',
            args: { cafeId, date: FUTURE_DATE, excludeSlotId: slotIds[0] },
          },
        },
        { role: 'model', text: 'Here are a couple of alternatives.' },
      ];
      llm.script(script);

      const submit = await request(app.getHttpServer())
        .post('/agent/workflows')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: `The ${slotIds[0]} table is taken, what else is there?` })
        .expect(201);

      await worker.processOnce();

      const workflow = await request(app.getHttpServer())
        .get(`/agent/workflows/${submit.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const response = findFunctionResponse(workflow.body.history, 'propose_alternatives') as unknown as Array<{
        slotId: string;
        tableId: string;
      }>;
      expect(Array.isArray(response)).toBe(true);
      expect(response.length).toBeLessThanOrEqual(2);
      expect(response.every((a) => a.slotId !== slotIds[0] && a.tableId === tableId)).toBe(true);
    });
  });
});
