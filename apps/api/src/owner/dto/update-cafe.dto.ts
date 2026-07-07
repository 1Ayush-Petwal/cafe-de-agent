import { IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Issue #18: owner-editable locator fields. Cuisines is the headline one
 * (PRD user story 29 — "set my café's cuisines"); location/hours are editable
 * here too so an owner-created café can appear correctly in the locator.
 */
export class UpdateCafeDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cuisines?: string[];

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  openingHour?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  closingHour?: number;
}
