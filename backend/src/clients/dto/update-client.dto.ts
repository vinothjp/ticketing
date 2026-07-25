import { IsString, IsOptional, IsEmail, IsIn } from 'class-validator';

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'TRIAL'])
  status?: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
}
