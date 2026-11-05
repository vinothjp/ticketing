import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { OPERATIONAL_HOURS } from '../operational-hours';

export class CreateSlaPolicyDto {
  @IsString()
  @IsNotEmpty()
  priority: string;

  @IsInt()
  @Min(1)
  resolutionHours: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  responseHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  everyResponseHours?: number;

  @IsOptional()
  @IsIn(OPERATIONAL_HOURS)
  operationalHours?: string;

  @IsOptional()
  @IsBoolean()
  escalationEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
