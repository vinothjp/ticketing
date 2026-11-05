import { IsOptional, IsString, IsNumber, IsPositive, IsDateString } from 'class-validator';

export class CreateWorklogDto {
  @IsNumber() @IsPositive() hours!: number;
  @IsOptional() @IsDateString() workDate?: string;
  @IsOptional() @IsString() note?: string;
  /** Optionally, the task on this ticket the time was spent on. */
  @IsOptional() @IsString() taskId?: string;
}
