import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAll } from './utils/test-app';

describe('Auth (e2e)', () => {
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

  it('signs up a new customer and returns a JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'alice@example.com', password: 'hunter2222' })
      .expect(201);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'alice@example.com', role: 'customer' });
  });

  it('rejects signup with a duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'bob@example.com', password: 'hunter2222' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'bob@example.com', password: 'different1' })
      .expect(409);
  });

  it('logs in with correct credentials and rejects wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'carol@example.com', password: 'hunter2222' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'carol@example.com', password: 'hunter2222' })
      .expect(201);
    expect(login.body.accessToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'carol@example.com', password: 'wrong-password' })
      .expect(401);
  });

  it('rejects unauthenticated access to reservations', async () => {
    await request(app.getHttpServer()).get('/reservations/mine').expect(401);
  });
});
