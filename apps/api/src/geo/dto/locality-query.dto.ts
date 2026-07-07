import { IsString, MinLength } from 'class-validator';

export class LocalityQueryDto {
  @IsString()
  @MinLength(1)
  query!: string;
}
