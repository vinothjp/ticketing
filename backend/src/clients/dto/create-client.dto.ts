import { IsString, IsNotEmpty, IsOptional, IsEmail, IsIn, IsBoolean, IsInt, Min, IsDateString, MinLength, ValidateIf } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'TRIAL'])
  status?: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';

  @IsOptional()
  @IsBoolean()
  createAdminUser?: boolean;

  @ValidateIf((o) => o.createAdminUser)
  @IsString()
  @IsNotEmpty()
  adminUsername?: string;

  @ValidateIf((o) => o.createAdminUser)
  @IsEmail()
  adminEmail?: string;

  @ValidateIf((o) => o.createAdminUser)
  @IsString()
  @MinLength(8)
  adminPassword?: string;

  @IsOptional()
  @IsBoolean()
  createLicense?: boolean;

  @ValidateIf((o) => o.createLicense)
  @IsString()
  @IsNotEmpty()
  licensePlan?: string;

  @ValidateIf((o) => o.createLicense)
  @IsInt()
  @Min(1)
  licenseMaxUsers?: number;

  @ValidateIf((o) => o.createLicense)
  @IsDateString()
  licenseStartDate?: string;

  @ValidateIf((o) => o.createLicense)
  @IsDateString()
  licenseExpiryDate?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'EXPIRED', 'CANCELLED'])
  licenseStatus?: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

  @IsOptional()
  @IsString()
  licenseNotes?: string;
}
