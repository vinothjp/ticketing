import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

export class UpsertPermissionDto {
  @IsString()
  @IsNotEmpty()
  roleId: string;

  @IsString()
  @IsNotEmpty()
  formId: string;

  @IsOptional()
  @IsBoolean()
  canCreate?: boolean;

  @IsOptional()
  @IsBoolean()
  canUpdate?: boolean;

  @IsOptional()
  @IsBoolean()
  canView?: boolean;

  @IsOptional()
  @IsBoolean()
  canDelete?: boolean;

  @IsOptional()
  @IsBoolean()
  canExport?: boolean;

  @IsOptional()
  @IsBoolean()
  canImport?: boolean;
}
