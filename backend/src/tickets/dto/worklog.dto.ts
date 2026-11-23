import { IsOptional, IsString, IsNumber, IsPositive, IsDateString } from 'class-validator';

export class CreateWorklogDto {
  @IsNumber() @IsPositive() hours!: number;
  @IsOptional() @IsDateString() workDate?: string;
  @IsOptional() @IsString() note?: string;
  /** Optionally, the task on this ticket the time was spent on. */
  @IsOptional() @IsString() taskId?: string;
}

/** Correct a Resolution-tab entry: its notes and/or hours. */
export class UpdateWorklogDto {
  @IsOptional() @IsNumber() @IsPositive() hours?: number;
  @IsOptional() @IsString() note?: string;
}
