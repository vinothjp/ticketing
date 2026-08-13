import { IsString, IsOptional, IsBoolean, IsIn, IsNotEmpty, IsArray } from 'class-validator';

const TRACKS = ['TECHNICAL', 'FUNCTIONAL'] as const;

export class CreateProductDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() code!: string; // free-form product code
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() autoAssign?: boolean;
}

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() autoAssign?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateModuleDto {
  @IsString() @IsNotEmpty() name!: string;
  // Tracks this module uses. Defaults to both when omitted.
  @IsOptional() @IsArray() @IsIn(TRACKS, { each: true }) tracks?: ('TECHNICAL' | 'FUNCTIONAL')[];
}

export class UpdateModuleDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsArray() @IsIn(TRACKS, { each: true }) tracks?: ('TECHNICAL' | 'FUNCTIONAL')[];
}

// Add an agent to a module's consultant list for a track.
export class AddConsultantDto {
  @IsIn(TRACKS) track!: 'TECHNICAL' | 'FUNCTIONAL';
  @IsString() @IsNotEmpty() userId!: string;
}
