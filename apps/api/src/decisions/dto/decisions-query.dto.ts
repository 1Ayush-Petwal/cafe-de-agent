import { IsUUID } from 'class-validator';

export class DecisionsQueryDto {
  @IsUUID()
  mandateId!: string;
}
