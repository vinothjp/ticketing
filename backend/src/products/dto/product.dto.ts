import { IsString, IsOptional, IsBoolean, IsNotEmpty, IsArray } from 'class-validator';

// Tracks are free-form: TECHNICAL and FUNCTIONAL are reserved conventions; any
// other value is a custom "Others" track the admin named.

export class CreateProductDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() code!: string; // free-form product code
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsBoolean() autoAssign?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) tracks?: string[];
}

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string | null;
  @IsOptional() @IsBoolean() autoAssign?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) tracks?: string[];
}

export class CreateModuleDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tracks?: string[];
}

export class UpdateModuleDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tracks?: string[];
}

// Add an agent to a module's or product's consultant list for a track.
export class AddConsultantDto {
  @IsString() @IsNotEmpty() track!: string;
  @IsString() @IsNotEmpty() userId!: string;
}
