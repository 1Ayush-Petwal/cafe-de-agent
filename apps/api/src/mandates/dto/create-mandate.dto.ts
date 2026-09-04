import { ArrayMinSize, IsArray, IsInt, IsISO8601, IsString, Min } from 'class-validator';

export class CreateMandateDto {
  @IsInt()
  @Min(1)
  maxPerBookingMinor!: number;

  @IsInt()
  @Min(1)
  maxTotalMinor!: number;

  @IsInt()
  @Min(1)
  maxBookings!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  allowedLocalities!: string[];

  @IsISO8601()
  windowStart!: string;

  @IsISO8601()
  windowEnd!: string;
}
