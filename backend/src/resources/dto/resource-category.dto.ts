import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateResourceCategoryDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsNumber() @Min(0) hourlyCost?: number;
  @IsOptional() @IsNumber() @Min(0) billingRate?: number;
  @IsOptional() @IsInt() @Min(1) dailyHours?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateResourceCategoryDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsNumber() @Min(0) hourlyCost?: number;
  @IsOptional() @IsNumber() @Min(0) billingRate?: number;
  @IsOptional() @IsInt() @Min(1) dailyHours?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
