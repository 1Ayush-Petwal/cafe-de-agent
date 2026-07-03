import { MinLength } from 'class-validator';

export class CreateWorkflowDto {
  @MinLength(1)
  message!: string;
}
