import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { TASK_STATUSES } from '../task-status';

export class CreateTaskDto {
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() assigneeUserId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() assigneeUserId?: string;
  @IsOptional() @IsIn(TASK_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}
