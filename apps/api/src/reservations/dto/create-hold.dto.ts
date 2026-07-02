import { IsUUID } from 'class-validator';

export class CreateHoldDto {
  @IsUUID()
  tableId!: string;

  @IsUUID()
  slotId!: string;
}
