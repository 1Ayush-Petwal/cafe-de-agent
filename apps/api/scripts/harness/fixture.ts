import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { computeSlotPriceMinor } from '../../src/pricing/slot-price';
import { CafeTable } from '../../src/entities/cafe-table.entity';
import { Cafe } from '../../src/entities/cafe.entity';
import { ReservationStatus } from '../../src/entities/reservation-status.enum';
import { Reservation } from '../../src/entities/reservation.entity';
import { Slot } from '../../src/entities/slot.entity';
import { User } from '../../src/entities/user.entity';
import { historicalFillWeight } from '../../src/seed/fill-weight';
import { createRng } from '../../src/seed/rng';
import { dailySlotTimes } from '../../src/seed/slot-grid';
import { HARNESS_CAFE_AREAS, HARNESS_FUTURE_DATE, HARNESS_PRICE_BAND_MINOR, HARNESS_TABLES_PER_CAFE } from './intents';

/** Same shape as seed.ts's own history depth — enough for a non-degenerate hot/cold spread. */
const HISTORY_WEEKS_BACK = 6;

export interface HarnessCafeFixture {
  cafeId: string;
  area: string;
  tableIds: string[];
  /** Indexed identically to `dailySlotTimes(HARNESS_FUTURE_DATE)` — `slotIds[hourIndex]`. */
  slotIds: string[];
}

export interface HarnessFixture {
  cafes: HarnessCafeFixture[];
}

function daysBefore(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds a fresh, structurally-identical café roster every call: same
 * areas, same price band, same future slot grid, and the same seeded
 * history weighted by {@link historicalFillWeight} — driven by `rng` so a
 * fixed `seed` reproduces the same demand-score spread (hot/cold) every
 * time, even though the rows themselves get new UUIDs. Called once per arm
 * so "both arms consume identical demand" never depends on truncating and
 * replaying state between them.
 */
export async function buildHarnessFixture(app: INestApplication, seed: number, namePrefix: string): Promise<HarnessFixture> {
  const dataSource = app.get(DataSource);
  const cafeRepo = dataSource.getRepository(Cafe);
  const tableRepo = dataSource.getRepository(CafeTable);
  const slotRepo = dataSource.getRepository(Slot);
  const userRepo = dataSource.getRepository(User);
  const reservationRepo = dataSource.getRepository(Reservation);

  const rng = createRng(seed);
  const futureHours = dailySlotTimes(HARNESS_FUTURE_DATE);
  const pastDates = Array.from({ length: HISTORY_WEEKS_BACK }, (_, week) => daysBefore(HARNESS_FUTURE_DATE, (week + 1) * 7));

  const historyUser = await userRepo.save(
    userRepo.create({ email: `${namePrefix}-history@cafedeagent.local`, passwordHash: 'unused' }),
  );

  const cafes: HarnessCafeFixture[] = [];
  for (const area of HARNESS_CAFE_AREAS) {
    const cafe = await cafeRepo.save(
      cafeRepo.create({
        name: `${namePrefix} ${area}`,
        area,
        priceBandMinor: HARNESS_PRICE_BAND_MINOR,
      }),
    );
    const tables = await tableRepo.save(
      Array.from({ length: HARNESS_TABLES_PER_CAFE }, (_, i) =>
        tableRepo.create({ cafeId: cafe.id, label: `T${i + 1}`, capacity: 2 }),
      ),
    );

    const futureSlots = await slotRepo.save(
      futureHours.map((slotTime) =>
        slotRepo.create({ cafeId: cafe.id, slotTime, priceMinor: computeSlotPriceMinor(cafe.priceBandMinor, slotTime) }),
      ),
    );

    // Seeded history (PRD area F): without it every hour bucket reads as
    // fill rate 0, every slot scores cold, and the mechanic can never be
    // distinguished from a coin flip.
    const pastSlots = await slotRepo.save(
      pastDates.flatMap((dateOnly) =>
        dailySlotTimes(dateOnly).map((slotTime) =>
          slotRepo.create({ cafeId: cafe.id, slotTime, priceMinor: computeSlotPriceMinor(cafe.priceBandMinor, slotTime) }),
        ),
      ),
    );
    const historicalReservations = [];
    for (const slot of pastSlots) {
      const weight = historicalFillWeight(slot.slotTime);
      for (const table of tables) {
        if (rng() < weight) {
          historicalReservations.push(
            reservationRepo.create({
              userId: historyUser.id,
              tableId: table.id,
              slotId: slot.id,
              status: ReservationStatus.BOOKED,
            }),
          );
        }
      }
    }
    await reservationRepo.save(historicalReservations);

    cafes.push({
      cafeId: cafe.id,
      area,
      tableIds: tables.map((t) => t.id),
      slotIds: futureSlots.map((s) => s.id),
    });
  }

  return { cafes };
}
