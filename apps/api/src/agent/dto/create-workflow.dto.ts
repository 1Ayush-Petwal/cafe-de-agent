import { IsOptional, IsUUID, MinLength } from 'class-validator';

export class CreateWorkflowDto {
  @MinLength(1)
  message!: string;

  /** Issue #7 (PRD area D): attaches a standing mandate to this conversation. */
  @IsOptional()
  @IsUUID()
  mandateId?: string;
}
