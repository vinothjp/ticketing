import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateSlaPolicyDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  resolutionHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  responseHours?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
