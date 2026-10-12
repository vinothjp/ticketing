import {
  IsString, IsNotEmpty, IsOptional, IsIn, MaxLength, IsDateString, IsArray, ArrayMaxSize,
} from 'class-validator';

export const COMMUNICATION_KINDS = ['ANNOUNCEMENT', 'NEWSLETTER'] as const;
/** Albums one communication may carry — a newsletter's month rarely has more. */
export const MAX_ALBUMS = 10;

export class CreateCommunicationDto {
  @IsIn(COMMUNICATION_KINDS) kind!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) subject!: string;
  @IsString() @IsNotEmpty() @MaxLength(50_000) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ALBUMS) @IsString({ each: true }) albumIds?: string[];
}

export class UpdateCommunicationDto {
  @IsOptional() @IsIn(COMMUNICATION_KINDS) kind?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) subject?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50_000) body?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ALBUMS) @IsString({ each: true }) albumIds?: string[];
}

export class LinkSuggestionAlbumDto {
  @IsString() @IsNotEmpty() albumId!: string;
}

export class MarkSuggestionUsedDto {
  @IsString() @IsNotEmpty() communicationId!: string;
}

export class ScheduleCommunicationDto {
  @IsDateString() scheduledAt!: string;
}
