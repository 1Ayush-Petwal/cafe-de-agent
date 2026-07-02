import { IsUUID } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  tableId!: string;

  @IsUUID()
  slotId!: string;
}
