import { IsOptional, IsString, IsInt, Min, Max, IsEmail } from 'class-validator';

export class CreateCompanyDto {
  @IsString() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxContacts?: number;
  @IsOptional() @IsString() status?: string;
}

export class UpdateCompanyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxContacts?: number;
  @IsOptional() @IsString() status?: string;
}

export class CreateContactDto {
  @IsString() username!: string;
  @IsEmail() email!: string;
  @IsString() password!: string;
}
