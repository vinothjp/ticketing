import { IsString, IsEmail, IsNotEmpty, IsOptional, MinLength, IsArray } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  // Roles to start with, so a new login is usable without a second save.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[];

  // ---- Employee Master ----
  // Optional at creation: an admin can seed the employee record here, or fill it
  // in later on the Employee Master screen.
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  managerId?: string;
}
