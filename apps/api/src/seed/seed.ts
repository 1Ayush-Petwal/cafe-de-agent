import 'dotenv/config';
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { DataSource, Like, Repository } from 'typeorm';
import { CafeTable } from '../entities/cafe-table.entity';
import { Cafe } from '../entities/cafe.entity';
import { ReservationStatus } from '../entities/reservation-status.enum';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { User } from '../entities/user.entity';
import { DELHI_CAFES } from './delhi-cafes';
import { historicalFillWeight } from './fill-weight';
import { createRng } from './rng';
import { dailySlotTimes, toDateOnly } from './slot-grid';
import { computeSlotPriceMinor } from '../pricing/slot-price';

const SEED_DAYS_AHEAD = 14;

/**
 * Issue #10 (PRD area F): several weeks of past bookings, hour- and
 * day-weighted from a fixed seed. Without this, `historical_fill_rate` is
 * zero for every slot on a fresh database, every slot scores cold, and the
 * slot-fill mechanic discounts everything — the margin-destruction outcome
 * it exists to avoid.
 */
const HISTORY_WEEKS_BACK = 6;
const HISTORY_USER_POOL_SIZE = 40;
const HISTORY_RNG_SEED = 20260904;

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [User, Cafe, CafeTable, Slot, Reservation],
    synchronize: true,
  });
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const cafeRepo = dataSource.getRepository(Cafe);
  const tableRepo = dataSource.getRepository(CafeTable);
  const slotRepo = dataSource.getRepository(Slot);
  const reservationRepo = dataSource.getRepository(Reservation);

  // Idempotent: wipe and reseed café/table/slot/reservation data. Users are left alone.
  await dataSource.query(
    'TRUNCATE TABLE reservations, slots, tables, cafes RESTART IDENTITY CASCADE',
  );

  const historyUserIds = await ensureHistoryUsers(userRepo);
  const rng = createRng(HISTORY_RNG_SEED);

  const today = new Date();
  const dateStrings = Array.from({ length: SEED_DAYS_AHEAD }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    return toDateOnly(d);
  });
  const pastDateStrings = Array.from({ length: HISTORY_WEEKS_BACK * 7 }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (i + 1));
    return toDateOnly(d);
  });

  for (const seedCafe of DELHI_CAFES) {
    const cafe = await cafeRepo.save(
      cafeRepo.create({
        name: seedCafe.name,
        area: seedCafe.area,
        description: seedCafe.description,
        latitude: seedCafe.latitude,
        longitude: seedCafe.longitude,
        openingHour: seedCafe.openingHour,
        closingHour: seedCafe.closingHour,
        cuisines: seedCafe.cuisines,
        rating: seedCafe.rating,
        ratingCount: seedCafe.ratingCount,
      }),
    );

    const tables = await tableRepo.save(
      seedCafe.tables.map((t) => tableRepo.create({ cafeId: cafe.id, ...t })),
    );

    const slots = dateStrings.flatMap((dateOnly) =>
      dailySlotTimes(dateOnly).map((slotTime) =>
        slotRepo.create({ cafeId: cafe.id, slotTime, priceMinor: computeSlotPriceMinor(cafe.priceBandMinor, slotTime) }),
      ),
    );
    await slotRepo.save(slots);

    const historicalSlots = pastDateStrings.flatMap((dateOnly) =>
      dailySlotTimes(dateOnly).map((slotTime) =>
        slotRepo.create({ cafeId: cafe.id, slotTime, priceMinor: computeSlotPriceMinor(cafe.priceBandMinor, slotTime) }),
      ),
    );
    const savedHistoricalSlots = await slotRepo.save(historicalSlots);

    const historicalReservations: Reservation[] = [];
    for (const slot of savedHistoricalSlots) {
      const weight = historicalFillWeight(slot.slotTime);
      for (const table of tables) {
        if (rng() < weight) {
          const userId = historyUserIds[Math.floor(rng() * historyUserIds.length)];
          historicalReservations.push(
            reservationRepo.create({
              userId,
              tableId: table.id,
              slotId: slot.id,
              status: ReservationStatus.BOOKED,
            }),
          );
        }
      }
    }
    await reservationRepo.save(historicalReservations);

    console.log(
      `Seeded ${cafe.name} (${tables.length} tables, ${slots.length} upcoming slots, ` +
        `${savedHistoricalSlots.length} historical slots, ${historicalReservations.length} historical bookings)`,
    );
  }

  await dataSource.destroy();
  console.log('Seed complete.');
}

/**
 * A fixed-size pool of synthetic buyers to attribute historical bookings to.
 * Users are never truncated by this script, so the pool is created once and
 * reused idempotently across reseeds rather than growing without bound.
 */
async function ensureHistoryUsers(userRepo: Repository<User>): Promise<string[]> {
  const existing = await userRepo.find({ where: { email: Like('seed-history-%@cafedeagent.local') } });
  const existingByEmail = new Map(existing.map((u) => [u.email, u.id]));
  const passwordHash = await bcrypt.hash('seed-history-unused', 4);

  const ids: string[] = [];
  const toCreate: User[] = [];
  for (let i = 0; i < HISTORY_USER_POOL_SIZE; i++) {
    const email = `seed-history-${i}@cafedeagent.local`;
    const existingId = existingByEmail.get(email);
    if (existingId) {
      ids.push(existingId);
      continue;
    }
    toCreate.push(userRepo.create({ email, passwordHash }));
  }
  if (toCreate.length > 0) {
    const saved = await userRepo.save(toCreate);
    ids.push(...saved.map((u) => u.id));
  }
  return ids;
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
