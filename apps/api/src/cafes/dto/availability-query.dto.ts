import { IsDateString } from 'class-validator';

export class AvailabilityQueryDto {
  @IsDateString({ strict: true }, { message: 'date must be an ISO date, e.g. 2026-07-04' })
  date!: string;
}
