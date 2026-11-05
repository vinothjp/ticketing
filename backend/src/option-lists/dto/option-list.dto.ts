import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  Matches,
  MaxLength,
} from 'class-validator';
import { MODULE_KEYS, OPTION_SOURCES } from '../default-lists';

export class CreateOptionListDto {
  // ASSET_TYPE style: it is the admin-facing key and, for a custom list, the
  // `listKey` its values are stored under.
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(/^[A-Za-z][A-Za-z0-9_]*$/, {
    message: 'Code must start with a letter and contain only letters, numbers and underscores',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Which store holds the values. Superseded by `module` for the screen, kept
  // for a caller that names the store directly.
  @IsOptional()
  @IsIn(OPTION_SOURCES as unknown as string[])
  source?: string;

  // Which screen area the list belongs to. The module decides the store, so a
  // caller sending this need not send `source`.
  @IsOptional()
  @IsIn(MODULE_KEYS)
  module?: string;

  @IsOptional()
  @IsString()
  parentListKey?: string;

  @IsOptional()
  @IsBoolean()
  allowCustom?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateOptionListDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(/^[A-Za-z][A-Za-z0-9_]*$/, {
    message: 'Code must start with a letter and contain only letters, numbers and underscores',
  })
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentListKey?: string;

  @IsOptional()
  @IsBoolean()
  allowCustom?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

// A value inside a list. `code`/`description`/`seq` are the screen's names for
// the backing tables' `value`/`label`/`sortOrder`.
export class CreateOptionValueDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentValue?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  seq?: number;
}

export class UpdateOptionValueDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentValue?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  seq?: number;
}
