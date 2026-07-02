import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { NotificationJobStatus } from '../src/entities/notification-job-status.enum';
import { NotificationJob } from '../src/entities/notification-job.entity';
import { Notification } from '../src/entities/notification.entity';
import { NotifierService } from '../src/notifications/notifier.service';
import { OUTBOX_MAX_ATTEMPTS, OutboxWorkerService } from '../src/notifications/outbox-worker.service';
import { createTestApp, Fixture, seedFixture, truncateAll } from './utils/test-app';

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken;
}

async function bookViaHoldConfirm(
  app: INestApplication,
  token: string,
  fixture: Fixture,
): Promise<string> {
  const hold = await request(app.getHttpServer())
    .post('/reservations/hold')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId: fixture.tableId, slotId: fixture.slotId })
    .expect(201);

  const confirm = await request(app.getHttpServer())
    .post('/reservations/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ holdId: hold.body.holdId, tableId: fixture.tableId, slotId: fixture.slotId })
    .expect(201);

  return confirm.body.id as string;
}

/**
 * Issue #6: confirming a booking enqueues a notify job atomically with the
 * booking commit (the transactional outbox), a worker drains the queue via
 * SKIP LOCKED, failed deliveries retry then dead-letter, and redelivery has
 * no double effect. Per the PRD's testing decision the worker runs
 * in-process during tests — `processOnce()` is called directly rather than
 * started on a timer, so these assertions are deterministic.
 */
describe('Booking notifications survive outages (e2e)', () => {
  let app: INestApplication;
  let fixture: Fixture;
  let notifier: NotifierService;
  let worker: OutboxWorkerService;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    notifier = app.get(NotifierService);
    worker = app.get(OutboxWorkerService);
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    notifier.setForceFailure(false);
    await truncateAll(app);
    fixture = await seedFixture(app);
  });

  afterAll(async () => {
    notifier.setForceFailure(false);
    await app.close();
  });

  it('enqueues a notify job atomically with the booking commit, and the worker delivers it', async () => {
    const token = await signup(app, 'alice@example.com');
    const reservationId = await bookViaHoldConfirm(app, token, fixture);

    const jobRepo = dataSource.getRepository(NotificationJob);
    const job = await jobRepo.findOne({ where: { reservationId } });
    expect(job).not.toBeNull();
    expect(job?.status).toBe(NotificationJobStatus.PENDING);

    const processed = await worker.processOnce();
    expect(processed).toBe(1);

    const doneJob = await jobRepo.findOne({ where: { reservationId } });
    expect(doneJob?.status).toBe(NotificationJobStatus.DONE);

    const res = await request(app.getHttpServer())
      .get('/notifications/mine')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reservationId).toBe(reservationId);
  });

  it('books at normal speed while the notifier is failing, then retries and dead-letters after N attempts', async () => {
    const token = await signup(app, 'alice@example.com');
    notifier.setForceFailure(true);

    const start = Date.now();
    const reservationId = await bookViaHoldConfirm(app, token, fixture);
    expect(Date.now() - start).toBeLessThan(1000);

    const jobRepo = dataSource.getRepository(NotificationJob);

    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
      await jobRepo.update({ reservationId }, { availableAt: new Date(0) });
      await worker.processOnce();
    }

    const job = await jobRepo.findOneOrFail({ where: { reservationId } });
    expect(job.status).toBe(NotificationJobStatus.DEAD_LETTER);
    expect(job.attempts).toBe(OUTBOX_MAX_ATTEMPTS);

    const notifRepo = dataSource.getRepository(Notification);
    expect(await notifRepo.count()).toBe(0);
  });

  it('has no double effect when the same job is redelivered (idempotent consumer)', async () => {
    const token = await signup(app, 'alice@example.com');
    const reservationId = await bookViaHoldConfirm(app, token, fixture);

    await worker.processOnce();

    const jobRepo = dataSource.getRepository(NotificationJob);
    // Simulate at-least-once redelivery: a crash between a successful
    // deliver() and the job being marked done would leave it pending again.
    await jobRepo.update({ reservationId }, { status: NotificationJobStatus.PENDING });
    const secondPass = await worker.processOnce();
    expect(secondPass).toBe(1);

    const notifRepo = dataSource.getRepository(Notification);
    const notifications = await notifRepo.find({ where: { reservationId } });
    expect(notifications).toHaveLength(1);
  });
});
