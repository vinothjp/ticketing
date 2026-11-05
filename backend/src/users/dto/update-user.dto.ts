import { IsString, IsEmail, IsOptional, IsBoolean, MinLength, ValidateIf } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // ---- Employee Master ----
  // Internal staff are the employees, so their employee record is edited here.
  // Every field is nullable: clearing a box sends null, which is how an employee
  // id or a manager is unassigned. `ValidateIf` lets that null through @IsString.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  employeeId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  department?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  designation?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  phone?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  managerId?: string | null;
}
