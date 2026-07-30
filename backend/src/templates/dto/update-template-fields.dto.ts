import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { FieldVisibility, FieldRequirement } from '@prisma/client';
import { FIELD_CATALOG } from '../../tickets/field-catalog';

const FIELD_KEYS = FIELD_CATALOG.map((f) => f.key);

export class TemplateFieldConfigDto {
  @IsIn(FIELD_KEYS)
  fieldKey: string;

  @IsEnum(FieldVisibility)
  visibility: FieldVisibility;

  @IsEnum(FieldRequirement)
  requirement: FieldRequirement;

  @IsBoolean()
  readOnly: boolean;

  @IsInt()
  sortOrder: number;

  @IsOptional()
  @IsString()
  helperTextOverride?: string;

  @IsOptional()
  @IsString()
  defaultValueOverride?: string;
}

export class UpdateTemplateFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldConfigDto)
  fields: TemplateFieldConfigDto[];
}
