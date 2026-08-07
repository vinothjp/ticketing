import {
  IsArray, IsBoolean, IsDateString, IsIn, IsObject, IsOptional, IsString, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Fixed Activity list from the Excel spec ("21 Project Time Sheet.xlsx").
export const TIMESHEET_ACTIVITIES = [
  'Blueprint',
  'System Configuration',
  'Unit Testing',
  'UAT',
  'Training',
  'Cut over',
  'PRD Deployment',
  'Go-Live Support',
] as const;

// One grid row: a (project, activity) pairing with a per-day hours map keyed by
// ISO date (yyyy-mm-dd) → hours. Days outside the requested week are ignored.
export class SaveRowDto {
  @IsString() projectId!: string;
  @IsIn(TIMESHEET_ACTIVITIES as unknown as string[]) activity!: string;
  @IsOptional() @IsString() workPerformed?: string;
  @IsObject() days!: Record<string, number>;
}

export class SaveWeekDto {
  @IsDateString() weekStart!: string;              // Monday of the target week (yyyy-mm-dd)
  @IsOptional() @IsString() userId?: string;       // consultant; defaults to the caller
  @IsOptional() @IsBoolean() submit?: boolean;     // true = SUBMITTED, false/omitted = DRAFT
  @IsOptional() @IsString() documentNumber?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SaveRowDto) rows!: SaveRowDto[];
}
