import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  descriptionGuidance?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
