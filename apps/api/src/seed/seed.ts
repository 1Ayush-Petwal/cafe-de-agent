import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CafeTable } from '../entities/cafe-table.entity';
import { Cafe } from '../entities/cafe.entity';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { User } from '../entities/user.entity';
import { DELHI_CAFES } from './delhi-cafes';
import { dailySlotTimes, toDateOnly } from './slot-grid';

const SEED_DAYS_AHEAD = 14;

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [User, Cafe, CafeTable, Slot, Reservation],
    synchronize: true,
  });
  await dataSource.initialize();

  const cafeRepo = dataSource.getRepository(Cafe);
  const tableRepo = dataSource.getRepository(CafeTable);
  const slotRepo = dataSource.getRepository(Slot);

  // Idempotent: wipe and reseed café/table/slot/reservation data. Users are left alone.
  await dataSource.query(
    'TRUNCATE TABLE reservations, slots, tables, cafes RESTART IDENTITY CASCADE',
  );

  const today = new Date();
  const dateStrings = Array.from({ length: SEED_DAYS_AHEAD }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    return toDateOnly(d);
  });

  for (const seedCafe of DELHI_CAFES) {
    const cafe = await cafeRepo.save(
      cafeRepo.create({
        name: seedCafe.name,
        area: seedCafe.area,
        description: seedCafe.description,
      }),
    );

    await tableRepo.save(
      seedCafe.tables.map((t) => tableRepo.create({ cafeId: cafe.id, ...t })),
    );

    const slots = dateStrings.flatMap((dateOnly) =>
      dailySlotTimes(dateOnly).map((slotTime) => slotRepo.create({ cafeId: cafe.id, slotTime })),
    );
    await slotRepo.save(slots);

    console.log(`Seeded ${cafe.name} (${seedCafe.tables.length} tables, ${slots.length} slots)`);
  }

  await dataSource.destroy();
  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
