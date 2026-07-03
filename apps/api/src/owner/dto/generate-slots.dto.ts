import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class GenerateSlotsDto {
  @IsDateString({ strict: true }, { message: 'startDate must be an ISO date, e.g. 2026-07-04' })
  startDate!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  days?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  openHour?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  closeHour?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  turnTimeMinutes?: number;
}
