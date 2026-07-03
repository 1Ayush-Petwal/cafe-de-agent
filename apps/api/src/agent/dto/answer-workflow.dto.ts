import { MinLength } from 'class-validator';

export class AnswerWorkflowDto {
  @MinLength(1)
  answer!: string;
}
