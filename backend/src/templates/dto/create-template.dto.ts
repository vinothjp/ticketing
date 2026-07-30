import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { FieldVisibility, FieldRequirement } from '@prisma/client';

export class TemplateFieldOptionDto {
  @IsString()
  value: string;

  @IsString()
  label: string;
}

/**
 * One field on a template — either a catalog/system field (isCustom = false,
 * identified by fieldKey) or an admin-designed custom field (isCustom = true,
 * carrying its own label/dataType/options).
 */
export class TemplateFieldInputDto {
  @IsOptional()
  @IsString()
  fieldKey?: string;

  @IsOptional()
  @IsBoolean()
  isCustom?: boolean;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  dataType?: string;

  @IsOptional()
  @IsString()
  group?: string;

  @IsOptional()
  @IsString()
  placeholder?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldOptionDto)
  options?: TemplateFieldOptionDto[];

  @IsOptional()
  @IsEnum(FieldVisibility)
  visibility?: FieldVisibility;

  @IsOptional()
  @IsEnum(FieldRequirement)
  requirement?: FieldRequirement;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  helperTextOverride?: string;

  @IsOptional()
  @IsString()
  defaultValueOverride?: string;
}

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  descriptionGuidance?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  defaultPriority?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldInputDto)
  fields?: TemplateFieldInputDto[];
}
