import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  tableId!: string;

  @IsUUID()
  slotId!: string;

  @IsUUID()
  holdId!: string;

  /** Issue #5/#8: when set, the order is created only after this mandate allows the preview. */
  @IsOptional()
  @IsUUID()
  mandateId?: string;

  /** Opaque conversation/agent id, carried through to the order's notes. Not yet populated by any caller (issue #31). */
  @IsOptional()
  @IsString()
  agentId?: string;
}
