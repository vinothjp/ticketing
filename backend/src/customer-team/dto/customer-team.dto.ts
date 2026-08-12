import { IsString, IsEmail, IsOptional, IsIn, MinLength, IsBoolean } from 'class-validator';

export class CreateTeamMemberDto {
  @IsString() username!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
  // 'employee' (default) or 'admin' (a co-administrator of this company).
  @IsOptional() @IsIn(['employee', 'admin']) role?: 'employee' | 'admin';
}

export class UpdateTeamMemberDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsIn(['employee', 'admin']) role?: 'employee' | 'admin';
}
