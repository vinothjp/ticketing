import { IsString, IsOptional, IsBoolean, IsIn, IsNotEmpty } from 'class-validator';

export class CreateProductDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() code!: string; // B1 | S4HANA | OTHERS (free-form, but these drive behaviour)
  @IsOptional() @IsBoolean() autoAssign?: boolean;
}

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsBoolean() autoAssign?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateModuleDto {
  @IsString() @IsNotEmpty() name!: string;
}

export class UpdateModuleDto {
  @IsString() @IsNotEmpty() name!: string;
}

// Upsert (or clear) a single consultant slot on a module.
export class SetConsultantDto {
  @IsIn(['TECHNICAL', 'FUNCTIONAL']) track!: 'TECHNICAL' | 'FUNCTIONAL';
  @IsIn(['PRIMARY', 'SECONDARY']) rank!: 'PRIMARY' | 'SECONDARY';
  @IsOptional() @IsString() userId?: string | null; // null/omitted clears the slot
}
