import { IsString, IsNotEmpty, IsInt, Min, IsDateString, IsOptional, IsIn } from 'class-validator';

export class UpsertLicenseDto {
  @IsString()
  @IsNotEmpty()
  plan: string;

  @IsInt()
  @Min(1)
  maxUsers: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  expiryDate: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'EXPIRED', 'CANCELLED'])
  status?: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

  @IsOptional()
  @IsString()
  notes?: string;
}
