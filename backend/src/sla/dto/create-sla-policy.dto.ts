import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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
  @IsBoolean()
  isActive?: boolean;
}
