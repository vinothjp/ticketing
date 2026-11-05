import { IsString, IsOptional, IsBoolean, IsObject, IsNotEmpty } from 'class-validator';

// blueprint shape (validated loosely; the designer controls the structure):
//   { milestones: [{ name, tasks: [{ title, wbsType?, durationDays? }] }] }
export class CreateProjectTemplateDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsObject() blueprint?: Record<string, unknown>;
}

export class UpdateProjectTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() blueprint?: Record<string, unknown>;
}
