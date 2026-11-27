import { IsString, IsEmail, IsOptional, IsIn, MinLength, MaxLength, IsBoolean } from 'class-validator';

// No `role` on create: a client has exactly one CustomerAdmin, so everyone a
// customer admin adds here starts as an employee.
export class CreateTeamMemberDto {
  @IsString() username!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
}

export class UpdateTeamMemberDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  // 'admin' hands the actor's admin role over to this member (the actor becomes
  // an employee); 'employee' demotes another admin. Never two admins after.
  @IsOptional() @IsIn(['employee', 'admin']) role?: 'employee' | 'admin';
  // Profile — the customer admin edits their own and their employees'.
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) username?: string;
  @IsOptional() @IsEmail() email?: string;
  // Full name; an empty string clears it.
  @IsOptional() @IsString() @MaxLength(150) name?: string;
}
