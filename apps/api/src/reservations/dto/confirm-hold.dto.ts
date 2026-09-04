import { IsOptional, IsUUID } from 'class-validator';

export class ConfirmHoldDto {
  @IsUUID()
  holdId!: string;

  @IsUUID()
  tableId!: string;

  @IsUUID()
  slotId!: string;

  /** Issue #5 (PRD area B): when set, the confirm is gated atomically against this mandate. */
  @IsOptional()
  @IsUUID()
  mandateId?: string;
}
