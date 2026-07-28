import { IsDateString, IsInt, IsOptional, IsString, IsNotEmpty } from 'class-validator';

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
  @IsOptional() @IsString() status?: string; // OPEN | IN_PROGRESS | DONE
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}
