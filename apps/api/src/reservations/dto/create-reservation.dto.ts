import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { BookingStrategy } from '../booking-strategy.enum';

export class CreateReservationDto {
  @IsUUID()
  tableId!: string;

  @IsUUID()
  slotId!: string;

  /** Defaults to `unique` in the service. Exists for the M1 strategy comparison. */
  @IsOptional()
  @IsEnum(BookingStrategy)
  strategy?: BookingStrategy;
}
