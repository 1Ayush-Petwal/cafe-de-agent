import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { CafeTable } from '../entities/cafe-table.entity';
import { Cafe } from '../entities/cafe.entity';
import { NotificationJob } from '../entities/notification-job.entity';
import { Notification } from '../entities/notification.entity';
import { Payment } from '../entities/payment.entity';
import { Reservation } from '../entities/reservation.entity';
import { Slot } from '../entities/slot.entity';
import { User } from '../entities/user.entity';

export function buildTypeOrmConfig(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [User, Cafe, CafeTable, Slot, Reservation, Payment, NotificationJob, Notification],
    // No migrations yet at M0 (tracer bullet); schema is generated from
    // entities. Migrations arrive when the schema needs to survive prod data.
    synchronize: true,
    logging: false,
  };
}
