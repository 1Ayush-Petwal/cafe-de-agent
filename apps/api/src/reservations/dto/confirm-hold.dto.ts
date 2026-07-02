import { IsUUID } from 'class-validator';

export class ConfirmHoldDto {
  @IsUUID()
  holdId!: string;

  @IsUUID()
  tableId!: string;

  @IsUUID()
  slotId!: string;
}
