import {
  IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsNotEmpty, Min,
} from 'class-validator';
import { TASK_STATUSES } from '../task-status';

export class CreateTaskDto {
  @IsString() @IsNotEmpty() title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() assigneeUserId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  // What the task is expected to take. Asked for when the task is raised because
  // it is the figure the "log time" prompt is prefilled with on the first status
  // change — an estimate, never itself charged to the support-hours pool.
  @IsOptional() @IsNumber() @Min(0) estimatedHours?: number;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() assigneeUserId?: string;
  @IsOptional() @IsIn(TASK_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  // `estimatedHours` is deliberately absent: the estimate is what the task was
  // raised against, so it is typed once on create and read-only thereafter — a
  // figure that could be edited afterwards is not an estimate. The global
  // `forbidNonWhitelisted` pipe rejects it outright rather than ignoring it.
  //
  // Time actually spent, booked as a `TicketWorklog` against this task. Sent by
  // the edit screen's completion prompt; a zero or absent figure books nothing,
  // so an edit that only renames the task charges no hours.
  @IsOptional() @IsNumber() @Min(0) logHours?: number;
  // Why a completed task is being pulled back open. Mandatory on that one
  // transition (`TasksService.update` rejects a blank one) and ignored on every
  // other, so it is optional here.
  @IsOptional() @IsString() reopenNote?: string;
}
