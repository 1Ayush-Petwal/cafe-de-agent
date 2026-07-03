import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AgentToolsService } from '../../src/agent/agent-tools.service';
import { AppModule } from '../../src/app.module';
import { CafeTable } from '../../src/entities/cafe-table.entity';
import { Cafe } from '../../src/entities/cafe.entity';
import { Slot } from '../../src/entities/slot.entity';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  // Listen explicitly (rather than relying on supertest's implicit per-request
  // `listen(0)`): many concurrent supertest requests as the very first traffic
  // to an unlistened http.Server race on that implicit listen and can produce
  // spurious ECONNRESETs under the concurrent-booking tests (M1, issue #3).
  // Bound to the IPv4 loopback explicitly: a dual-stack `listen(0)` reports
  // its address as bracketed `[::1]`, and the agent's tool calls (below) are
  // real `fetch()`s that would then get sent through the sandbox's outbound
  // proxy instead of straight to loopback, since its `NO_PROXY` only covers
  // unbracketed `::1`.
  await app.listen(0, '127.0.0.1');
  // The agent's tools are real HTTP calls back into the app's own public API
  // (issue #9) — point them at this test app's actual ephemeral port so
  // those calls exercise the real endpoints instead of a hardcoded default.
  app.get(AgentToolsService).setBaseUrl(await app.getUrl());
  return app;
}

export async function truncateAll(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  await dataSource.query(
    'TRUNCATE TABLE agent_workflows, idempotency_keys, notifications, notification_jobs, payments, reservations, slots, tables, cafes, users RESTART IDENTITY CASCADE',
  );
}

export interface Fixture {
  cafeId: string;
  tableId: string;
  slotId: string;
  otherTableId: string;
  slotTime: Date;
}

/** Seeds one café with two tables and a single slot, for booking tests. */
export async function seedFixture(app: INestApplication): Promise<Fixture> {
  const dataSource = app.get(DataSource);
  const cafeRepo = dataSource.getRepository(Cafe);
  const tableRepo = dataSource.getRepository(CafeTable);
  const slotRepo = dataSource.getRepository(Slot);

  const cafe = await cafeRepo.save(
    cafeRepo.create({ name: 'Test Café', area: 'Connaught Place', description: 'fixture' }),
  );
  const table = await tableRepo.save(tableRepo.create({ cafeId: cafe.id, label: 'T1', capacity: 2 }));
  const otherTable = await tableRepo.save(
    tableRepo.create({ cafeId: cafe.id, label: 'T2', capacity: 4 }),
  );
  const slotTime = new Date('2026-08-01T09:00:00.000Z');
  const slot = await slotRepo.save(slotRepo.create({ cafeId: cafe.id, slotTime }));

  return {
    cafeId: cafe.id,
    tableId: table.id,
    otherTableId: otherTable.id,
    slotId: slot.id,
    slotTime,
  };
}
