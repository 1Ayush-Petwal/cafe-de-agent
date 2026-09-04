import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class AlternativesQueryDto {
  @IsDateString({ strict: true }, { message: 'date must be an ISO date, e.g. 2026-07-04' })
  date!: string;

  /** The slot the buyer actually asked for, if any — never re-offered as its own alternative. */
  @IsOptional()
  @IsUUID()
  excludeSlotId?: string;

  /** When set, every candidate is screened through this mandate's preview before being offered. */
  @IsOptional()
  @IsUUID()
  mandateId?: string;
}
