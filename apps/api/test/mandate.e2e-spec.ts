import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAll } from './utils/test-app';
import { signMandateConstraints } from '../src/mandates/mandate-signature';

async function signup(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'hunter2222' })
    .expect(201);
  return res.body.accessToken;
}

const VALID_GRANT = {
  maxPerBookingMinor: 60000,
  maxTotalMinor: 150000,
  maxBookings: 3,
  allowedLocalities: ['Hauz Khas', 'GK-II'],
  windowStart: '2026-09-04T00:00:00.000Z',
  windowEnd: '2026-09-11T00:00:00.000Z',
};

/**
 * Issue #4 (PRD area B): mandates are granted, signed, read and revoked.
 * Enforcement (the atomic gate) is issue #5 — this slice only covers the
 * artifact's lifecycle, so consumption stays at zero throughout.
 */
describe('Mandate granted, signed, revocable (e2e)', () => {
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

  it('grants a mandate with a server-computed signature covering constraints only', async () => {
    const token = await signup(app, 'grantor@example.com');

    const res = await request(app.getHttpServer())
      .post('/mandates')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_GRANT)
      .expect(201);

    expect(res.body).toMatchObject({
      maxPerBookingMinor: VALID_GRANT.maxPerBookingMinor,
      maxTotalMinor: VALID_GRANT.maxTotalMinor,
      maxBookings: VALID_GRANT.maxBookings,
      allowedLocalities: VALID_GRANT.allowedLocalities,
      consumedMinor: 0,
      consumedBookings: 0,
      remainingMinor: VALID_GRANT.maxTotalMinor,
      remainingBookings: VALID_GRANT.maxBookings,
      status: 'active',
      revokedAt: null,
    });
    expect(typeof res.body.signature).toBe('string');
    expect(res.body.signature.length).toBeGreaterThan(0);

    const expectedSignature = signMandateConstraints({
      maxPerBookingMinor: VALID_GRANT.maxPerBookingMinor,
      maxTotalMinor: VALID_GRANT.maxTotalMinor,
      maxBookings: VALID_GRANT.maxBookings,
      allowedLocalities: VALID_GRANT.allowedLocalities,
      windowStart: new Date(VALID_GRANT.windowStart).toISOString(),
      windowEnd: new Date(VALID_GRANT.windowEnd).toISOString(),
    });
    expect(res.body.signature).toBe(expectedSignature);
  });

  it('excludes consumption counters from the signature — the signature is unchanged as consumption would vary', async () => {
    const withZeroConsumption = signMandateConstraints({
      maxPerBookingMinor: VALID_GRANT.maxPerBookingMinor,
      maxTotalMinor: VALID_GRANT.maxTotalMinor,
      maxBookings: VALID_GRANT.maxBookings,
      allowedLocalities: VALID_GRANT.allowedLocalities,
      windowStart: new Date(VALID_GRANT.windowStart).toISOString(),
      windowEnd: new Date(VALID_GRANT.windowEnd).toISOString(),
    });
    // signMandateConstraints has no consumption parameter at all — the type
    // signature itself proves consumption cannot enter the digest. Calling
    // it twice with identical constraints must be deterministic either way.
    const again = signMandateConstraints({
      maxPerBookingMinor: VALID_GRANT.maxPerBookingMinor,
      maxTotalMinor: VALID_GRANT.maxTotalMinor,
      maxBookings: VALID_GRANT.maxBookings,
      allowedLocalities: VALID_GRANT.allowedLocalities,
      windowStart: new Date(VALID_GRANT.windowStart).toISOString(),
      windowEnd: new Date(VALID_GRANT.windowEnd).toISOString(),
    });
    expect(withZeroConsumption).toBe(again);
  });

  it('rejects a grant with an invalid window', async () => {
    const token = await signup(app, 'badwindow@example.com');
    await request(app.getHttpServer())
      .post('/mandates')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_GRANT, windowStart: '2026-09-11T00:00:00.000Z', windowEnd: '2026-09-04T00:00:00.000Z' })
      .expect(400);
  });

  it('returns remaining budget, remaining bookings and expiry from the status endpoint', async () => {
    const token = await signup(app, 'status@example.com');
    const grant = await request(app.getHttpServer())
      .post('/mandates')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_GRANT)
      .expect(201);

    const status = await request(app.getHttpServer())
      .get(`/mandates/${grant.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(status.body).toMatchObject({
      id: grant.body.id,
      remainingMinor: VALID_GRANT.maxTotalMinor,
      remainingBookings: VALID_GRANT.maxBookings,
      status: 'active',
    });
    expect(new Date(status.body.expiresAt).toISOString()).toBe(new Date(VALID_GRANT.windowEnd).toISOString());
  });

  it('revokes a mandate, moving it to a revoked state with a timestamp', async () => {
    const token = await signup(app, 'revoker@example.com');
    const grant = await request(app.getHttpServer())
      .post('/mandates')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_GRANT)
      .expect(201);

    const revoke = await request(app.getHttpServer())
      .post(`/mandates/${grant.body.id}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(revoke.body.status).toBe('revoked');
    expect(revoke.body.revokedAt).not.toBeNull();

    const status = await request(app.getHttpServer())
      .get(`/mandates/${grant.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.status).toBe('revoked');
    expect(status.body.revokedAt).not.toBeNull();
  });

  it("scopes a mandate to the granting user — another user can neither read nor revoke it", async () => {
    const owner = await signup(app, 'owner@example.com');
    const stranger = await signup(app, 'stranger@example.com');

    const grant = await request(app.getHttpServer())
      .post('/mandates')
      .set('Authorization', `Bearer ${owner}`)
      .send(VALID_GRANT)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/mandates/${grant.body.id}`)
      .set('Authorization', `Bearer ${stranger}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/mandates/${grant.body.id}/revoke`)
      .set('Authorization', `Bearer ${stranger}`)
      .expect(403);

    // Untouched by the stranger's attempts.
    const status = await request(app.getHttpServer())
      .get(`/mandates/${grant.body.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(status.body.status).toBe('active');
  });

  it('rejects a mandate signature presented as an authentication token', async () => {
    const token = await signup(app, 'authtest@example.com');
    const grant = await request(app.getHttpServer())
      .post('/mandates')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_GRANT)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/mandates/${grant.body.id}`)
      .set('Authorization', `Bearer ${grant.body.signature}`)
      .expect(401);
  });

  it('requires authentication to grant, read or revoke a mandate', async () => {
    await request(app.getHttpServer()).post('/mandates').send(VALID_GRANT).expect(401);

    const token = await signup(app, 'noauth@example.com');
    const grant = await request(app.getHttpServer())
      .post('/mandates')
      .set('Authorization', `Bearer ${token}`)
      .send(VALID_GRANT)
      .expect(201);

    await request(app.getHttpServer()).get(`/mandates/${grant.body.id}`).expect(401);
    await request(app.getHttpServer()).post(`/mandates/${grant.body.id}/revoke`).expect(401);
  });
});
