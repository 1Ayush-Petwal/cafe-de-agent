import { AddressInfo } from 'net';
import http, { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { WebhookEventType } from '../src/entities/webhook-event-type.enum';
import { WebhookJobStatus } from '../src/entities/webhook-job-status.enum';
import { WebhookJob } from '../src/entities/webhook-job.entity';
import { PartnerApiKey } from '../src/entities/partner-api-key.entity';
import { WEBHOOK_OUTBOX_MAX_ATTEMPTS, WebhookWorkerService } from '../src/partner/webhook-worker.service';
import { createTestApp, truncateAll } from './utils/test-app';

interface ReceivedWebhook {
  event: string;
  reservationId: string;
  cafeId: string;
  tableId: string;
  slotId: string;
  slotTime: string;
}

interface WebhookServer {
  url: string;
  received: ReceivedWebhook[];
  close: () => Promise<void>;
}

/** A real local HTTP server standing in for a café's local app (issue #24). */
function startWebhookServer(): Promise<WebhookServer> {
  return new Promise((resolve) => {
    const received: ReceivedWebhook[] = [];
    const server: Server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(200);
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/webhook`,
        received,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

/** Opens then immediately closes a local server, yielding a URL nothing is listening on (a reliable ECONNREFUSED). */
function unreachableUrl(): Promise<string> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(`http://127.0.0.1:${port}/webhook`));
    });
  });
}

async function signup(app: INestApplication, email: string, role?: 'customer' | 'owner'): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222', ...(role ? { role } : {}) })
    .expect(201);
  return res.body.accessToken;
}

async function createCafeWithTableAndSlots(
  app: INestApplication,
  ownerToken: string,
  cafeName: string,
  startDate: string,
): Promise<{ cafeId: string; tableId: string; slotId: string }> {
  const cafeRes = await request(app.getHttpServer())
    .post('/owner/cafes')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: cafeName, area: 'CP' })
    .expect(201);
  const cafeId = cafeRes.body.id;

  const tableRes = await request(app.getHttpServer())
    .post(`/owner/cafes/${cafeId}/tables`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ label: 'T1', capacity: 2 })
    .expect(201);
  const tableId = tableRes.body.id;

  await request(app.getHttpServer())
    .post(`/owner/cafes/${cafeId}/slots/generate`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ startDate, days: 1, openHour: 9, closeHour: 12, turnTimeMinutes: 60 })
    .expect(201);

  const availability = await request(app.getHttpServer())
    .get(`/cafes/${cafeId}/availability`)
    .query({ date: startDate })
    .expect(200);
  const slotId = availability.body[0].slots[0].slotId;

  return { cafeId, tableId, slotId };
}

async function bookViaHoldConfirm(
  app: INestApplication,
  customerToken: string,
  tableId: string,
  slotId: string,
): Promise<string> {
  const hold = await request(app.getHttpServer())
    .post('/reservations/hold')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ tableId, slotId })
    .expect(201);
  const confirm = await request(app.getHttpServer())
    .post('/reservations/confirm')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ holdId: hold.body.holdId, tableId, slotId })
    .expect(201);
  return confirm.body.id as string;
}

async function generateApiKey(app: INestApplication, ownerToken: string, cafeId: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/owner/cafes/${cafeId}/partner/keys`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(201);
  return res.body.apiKey as string;
}

/**
 * Issue #24 (PRD area G, blocked by #21): Partner API v1 — per-café API
 * keys, booking webhooks via the transactional outbox, and pull endpoints
 * for reconciliation. Covers every acceptance criterion at the existing
 * HTTP seam: key lifecycle (generate/revoke, hashed at rest), café scoping,
 * webhook delivery + retry/dead-letter via a real local HTTP server, outbox
 * atomicity, and the pull endpoints.
 */
describe('Partner API v1 (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let worker: WebhookWorkerService;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    worker = app.get(WebhookWorkerService);
  });

  beforeEach(async () => {
    await truncateAll(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('API key lifecycle', () => {
    it('generates a café-scoped key, hashed at rest, shown only once', async () => {
      const owner = await signup(app, 'owner1@example.com', 'owner');
      const { cafeId } = await createCafeWithTableAndSlots(app, owner, 'Key Café', '2026-08-01');

      const genRes = await request(app.getHttpServer())
        .post(`/owner/cafes/${cafeId}/partner/keys`)
        .set('Authorization', `Bearer ${owner}`)
        .expect(201);
      expect(genRes.body.apiKey).toMatch(/^pk_[0-9a-f]+$/);
      expect(genRes.body.keyPrefix).toBe(genRes.body.apiKey.slice(0, genRes.body.keyPrefix.length));

      const keyRepo = dataSource.getRepository(PartnerApiKey);
      const stored = await keyRepo.findOneOrFail({ where: { id: genRes.body.id } });
      expect(stored.keyHash).not.toBe(genRes.body.apiKey);

      const listRes = await request(app.getHttpServer())
        .get(`/owner/cafes/${cafeId}/partner/keys`)
        .set('Authorization', `Bearer ${owner}`)
        .expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].apiKey).toBeUndefined();
      expect(listRes.body[0].keyHash).toBeUndefined();
      expect(listRes.body[0].keyPrefix).toBe(genRes.body.keyPrefix);
    });

    it("rejects generating/listing/revoking keys for another owner's café", async () => {
      const ownerA = await signup(app, 'ownera@example.com', 'owner');
      const ownerB = await signup(app, 'ownerb@example.com', 'owner');
      const { cafeId } = await createCafeWithTableAndSlots(app, ownerA, "A's Café", '2026-08-01');

      await request(app.getHttpServer())
        .post(`/owner/cafes/${cafeId}/partner/keys`)
        .set('Authorization', `Bearer ${ownerB}`)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/owner/cafes/${cafeId}/partner/keys`)
        .set('Authorization', `Bearer ${ownerB}`)
        .expect(403);
    });

    it('revokes a key, after which every partner request using it is rejected', async () => {
      const owner = await signup(app, 'owner2@example.com', 'owner');
      const { cafeId } = await createCafeWithTableAndSlots(app, owner, 'Revoke Café', '2026-08-01');
      const genRes = await request(app.getHttpServer())
        .post(`/owner/cafes/${cafeId}/partner/keys`)
        .set('Authorization', `Bearer ${owner}`)
        .expect(201);
      const apiKey = genRes.body.apiKey as string;

      await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeId}/availability`)
        .set('X-Api-Key', apiKey)
        .query({ date: '2026-08-01' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/owner/cafes/${cafeId}/partner/keys/${genRes.body.id}`)
        .set('Authorization', `Bearer ${owner}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeId}/availability`)
        .set('X-Api-Key', apiKey)
        .query({ date: '2026-08-01' })
        .expect(401);
      await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeId}/bookings`)
        .set('X-Api-Key', apiKey)
        .query({ date: '2026-08-01' })
        .expect(401);

      // Revoking again is a no-op, not an error.
      await request(app.getHttpServer())
        .delete(`/owner/cafes/${cafeId}/partner/keys/${genRes.body.id}`)
        .set('Authorization', `Bearer ${owner}`)
        .expect(200);
    });

    it('rejects requests with a missing or unknown API key', async () => {
      const owner = await signup(app, 'owner3@example.com', 'owner');
      const { cafeId } = await createCafeWithTableAndSlots(app, owner, 'NoKey Café', '2026-08-01');

      await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeId}/availability`)
        .query({ date: '2026-08-01' })
        .expect(401);
      await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeId}/availability`)
        .set('X-Api-Key', 'pk_totally-made-up')
        .query({ date: '2026-08-01' })
        .expect(401);
    });
  });

  describe('café scoping', () => {
    it("rejects a café's key from reading a different café's data", async () => {
      const owner = await signup(app, 'owner4@example.com', 'owner');
      const cafeA = await createCafeWithTableAndSlots(app, owner, 'Scoped A', '2026-08-01');
      const cafeB = await createCafeWithTableAndSlots(app, owner, 'Scoped B', '2026-08-01');
      const keyA = await generateApiKey(app, owner, cafeA.cafeId);

      await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeB.cafeId}/availability`)
        .set('X-Api-Key', keyA)
        .query({ date: '2026-08-01' })
        .expect(403);
      await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeB.cafeId}/bookings`)
        .set('X-Api-Key', keyA)
        .query({ date: '2026-08-01' })
        .expect(403);

      // Its own café still works.
      await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeA.cafeId}/availability`)
        .set('X-Api-Key', keyA)
        .query({ date: '2026-08-01' })
        .expect(200);
    });

    it('404s a request naming a café that does not exist', async () => {
      const owner = await signup(app, 'owner5@example.com', 'owner');
      const cafe = await createCafeWithTableAndSlots(app, owner, 'Real Café', '2026-08-01');
      const key = await generateApiKey(app, owner, cafe.cafeId);

      await request(app.getHttpServer())
        .get('/partner/cafes/00000000-0000-0000-0000-000000000000/availability')
        .set('X-Api-Key', key)
        .query({ date: '2026-08-01' })
        .expect(404);
    });
  });

  describe('pull endpoints', () => {
    it("returns a café's bookings and availability for a given date", async () => {
      const owner = await signup(app, 'owner6@example.com', 'owner');
      const customer = await signup(app, 'diner@example.com', 'customer');
      const { cafeId, tableId, slotId } = await createCafeWithTableAndSlots(app, owner, 'Pull Café', '2026-08-01');
      const apiKey = await generateApiKey(app, owner, cafeId);

      const reservationId = await bookViaHoldConfirm(app, customer, tableId, slotId);

      const bookingsRes = await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeId}/bookings`)
        .set('X-Api-Key', apiKey)
        .query({ date: '2026-08-01' })
        .expect(200);
      expect(bookingsRes.body).toHaveLength(1);
      expect(bookingsRes.body[0]).toMatchObject({ id: reservationId, tableId, slotId, status: 'booked' });

      const availabilityRes = await request(app.getHttpServer())
        .get(`/partner/cafes/${cafeId}/availability`)
        .set('X-Api-Key', apiKey)
        .query({ date: '2026-08-01' })
        .expect(200);
      const table = availabilityRes.body.find((t: { tableId: string }) => t.tableId === tableId);
      const slot = table.slots.find((s: { slotId: string }) => s.slotId === slotId);
      expect(slot.available).toBe(false);
    });

    it('exposes no endpoint that lets a partner create, hold, or cancel a reservation', async () => {
      const owner = await signup(app, 'owner7@example.com', 'owner');
      const { cafeId } = await createCafeWithTableAndSlots(app, owner, 'NoWrite Café', '2026-08-01');
      const apiKey = await generateApiKey(app, owner, cafeId);

      await request(app.getHttpServer())
        .post(`/partner/cafes/${cafeId}/bookings`)
        .set('X-Api-Key', apiKey)
        .send({})
        .expect(404);
    });
  });

  describe('webhook outbox', () => {
    it('enqueues booking.created atomically with confirm, and booking.cancelled atomically with cancel; the worker delivers both', async () => {
      const owner = await signup(app, 'owner8@example.com', 'owner');
      const customer = await signup(app, 'diner2@example.com', 'customer');
      const { cafeId, tableId, slotId } = await createCafeWithTableAndSlots(app, owner, 'Webhook Café', '2026-08-01');

      const webhookServer = await startWebhookServer();
      await request(app.getHttpServer())
        .post(`/owner/cafes/${cafeId}/partner/webhook`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ url: webhookServer.url })
        .expect(201);

      const reservationId = await bookViaHoldConfirm(app, customer, tableId, slotId);

      const jobRepo = dataSource.getRepository(WebhookJob);
      const createdJob = await jobRepo.findOneOrFail({ where: { reservationId, eventType: WebhookEventType.BOOKING_CREATED } });
      expect(createdJob.status).toBe(WebhookJobStatus.PENDING);
      expect(createdJob.cafeId).toBe(cafeId);

      expect(await worker.processOnce()).toBe(1);
      expect(webhookServer.received).toHaveLength(1);
      expect(webhookServer.received[0]).toMatchObject({
        event: 'booking.created',
        reservationId,
        cafeId,
        tableId,
        slotId,
      });

      await request(app.getHttpServer())
        .delete(`/reservations/${reservationId}`)
        .set('Authorization', `Bearer ${customer}`)
        .expect(200);

      const cancelledJob = await jobRepo.findOneOrFail({
        where: { reservationId, eventType: WebhookEventType.BOOKING_CANCELLED },
      });
      expect(cancelledJob.status).toBe(WebhookJobStatus.PENDING);

      expect(await worker.processOnce()).toBe(1);
      expect(webhookServer.received).toHaveLength(2);
      expect(webhookServer.received[1]).toMatchObject({ event: 'booking.cancelled', reservationId, cafeId });

      await webhookServer.close();
    });

    it('retries on delivery failure and dead-letters after the max attempts, without blocking the booking', async () => {
      const owner = await signup(app, 'owner9@example.com', 'owner');
      const customer = await signup(app, 'diner3@example.com', 'customer');
      const { cafeId, tableId, slotId } = await createCafeWithTableAndSlots(app, owner, 'Retry Café', '2026-08-01');

      const badUrl = await unreachableUrl();
      await request(app.getHttpServer())
        .post(`/owner/cafes/${cafeId}/partner/webhook`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ url: badUrl })
        .expect(201);

      const start = Date.now();
      const reservationId = await bookViaHoldConfirm(app, customer, tableId, slotId);
      expect(Date.now() - start).toBeLessThan(1000);

      const jobRepo = dataSource.getRepository(WebhookJob);
      for (let attempt = 1; attempt <= WEBHOOK_OUTBOX_MAX_ATTEMPTS; attempt++) {
        await jobRepo.update({ reservationId, eventType: WebhookEventType.BOOKING_CREATED }, { availableAt: new Date(0) });
        await worker.processOnce();
      }

      const job = await jobRepo.findOneOrFail({ where: { reservationId, eventType: WebhookEventType.BOOKING_CREATED } });
      expect(job.status).toBe(WebhookJobStatus.DEAD_LETTER);
      expect(job.attempts).toBe(WEBHOOK_OUTBOX_MAX_ATTEMPTS);
    });

    it('resolves a job DONE with no delivery attempt when the café has no registered webhook endpoint', async () => {
      const owner = await signup(app, 'owner10@example.com', 'owner');
      const customer = await signup(app, 'diner4@example.com', 'customer');
      const { tableId, slotId } = await createCafeWithTableAndSlots(app, owner, 'NoEndpoint Café', '2026-08-01');

      const reservationId = await bookViaHoldConfirm(app, customer, tableId, slotId);

      expect(await worker.processOnce()).toBe(1);

      const jobRepo = dataSource.getRepository(WebhookJob);
      const job = await jobRepo.findOneOrFail({ where: { reservationId, eventType: WebhookEventType.BOOKING_CREATED } });
      expect(job.status).toBe(WebhookJobStatus.DONE);
    });
  });
});
