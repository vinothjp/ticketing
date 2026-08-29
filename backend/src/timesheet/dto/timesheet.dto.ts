import {
  IsArray, IsBoolean, IsDateString, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Fixed Activity list from the Excel spec ("21 Project Time Sheet.xlsx").
// The activities every tenant starts with. The live list is the
// `timesheetActivity` option list (Option List screen); this array is what seeds
// it, and the fallback if a tenant has emptied it.
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
  // The activity list is the tenant's own `timesheetActivity` option list, so
  // membership is checked in the service against that list, not by @IsIn here.
  @IsString() @IsNotEmpty() activity!: string;
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
