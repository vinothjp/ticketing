import { IsString, IsNotEmpty, IsOptional, IsIn, MaxLength, IsDateString, IsBoolean, ValidateIf } from 'class-validator';

export const ALBUM_CATEGORIES = ['PROJECT_INITIATIVE', 'CLIENT_ACHIEVEMENT', 'UAT_SIGNOFF', 'AWARD', 'OTHER'] as const;

export class CreateAlbumDto {
  @IsString() @IsNotEmpty() @MaxLength(150) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsIn(ALBUM_CATEGORIES) category!: string;
  @IsOptional() @IsDateString() eventDate?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() customerCompanyId?: string;
}

/** Every field optional; an explicit null (or '') clears the optional ones. */
export class UpdateAlbumDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(150) title?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsIn(ALBUM_CATEGORIES) category?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() eventDate?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() projectId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() customerCompanyId?: string | null;
}

export class UpdatePhotoDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(300) caption?: string | null;
  /** true makes this photo the album's cover. */
  @IsOptional() @IsBoolean() cover?: boolean;
}
