import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCafeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  area!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
