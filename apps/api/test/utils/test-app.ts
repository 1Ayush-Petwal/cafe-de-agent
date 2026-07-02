import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
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
  await app.listen(0);
  return app;
}

export async function truncateAll(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  await dataSource.query('TRUNCATE TABLE reservations, slots, tables, cafes, users RESTART IDENTITY CASCADE');
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
