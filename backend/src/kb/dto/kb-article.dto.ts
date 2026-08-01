import {
  IsArray, IsIn, IsOptional, IsString, MinLength, IsDateString, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UrlReferenceDto {
  @IsOptional() @IsString() label?: string;
  @IsString() url!: string;
}

export class CreateKbArticleDto {
  @IsString() @MinLength(1) title!: string;
  @IsString() body!: string;

  @IsOptional() @IsIn(['KNOWLEDGE', 'PROBLEM']) articleType?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsString() module?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() versionNumber?: string;

  @IsOptional() @IsString() problemDescription?: string;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsString() cause?: string;
  @IsOptional() @IsString() prevention?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) keywords?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => UrlReferenceDto) urlReferences?: UrlReferenceDto[];

  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: string;
  @IsOptional() @IsIn(['INTERNAL', 'CUSTOMER']) audience?: string;
  @IsOptional() @IsString() knowledgeOwnerId?: string;
  @IsOptional() @IsDateString() publishedDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}

export class UpdateKbArticleDto {
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsString() body?: string;

  @IsOptional() @IsIn(['KNOWLEDGE', 'PROBLEM']) articleType?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsString() module?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() versionNumber?: string;

  @IsOptional() @IsString() problemDescription?: string;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsString() cause?: string;
  @IsOptional() @IsString() prevention?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) keywords?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => UrlReferenceDto) urlReferences?: UrlReferenceDto[];

  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: string;
  @IsOptional() @IsIn(['INTERNAL', 'CUSTOMER']) audience?: string;
  @IsOptional() @IsString() knowledgeOwnerId?: string;
  @IsOptional() @IsDateString() publishedDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}
