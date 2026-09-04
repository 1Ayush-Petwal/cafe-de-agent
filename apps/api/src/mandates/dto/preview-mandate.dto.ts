import { IsUUID } from 'class-validator';

export class PreviewMandateDto {
  @IsUUID()
  tableId!: string;

  @IsUUID()
  slotId!: string;
}
