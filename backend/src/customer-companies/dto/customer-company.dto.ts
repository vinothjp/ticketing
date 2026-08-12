import { IsOptional, IsString, IsInt, Min, Max, IsEmail, IsArray } from 'class-validator';

export class CreateCompanyDto {
  @IsString() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxContacts?: number;
  @IsOptional() @IsString() status?: string;
  // Products this company uses (limits what they can raise tickets for).
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
  // Optional bootstrap: seed the company's first CustomerAdmin login. After this
  // one hand-off, all further user management is done by the customer themselves.
  @IsOptional() @IsString() adminUsername?: string;
  @IsOptional() @IsEmail() adminEmail?: string;
  @IsOptional() @IsString() adminPassword?: string;
}

export class UpdateCompanyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxContacts?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
}

export class CreateContactDto {
  @IsString() username!: string;
  @IsEmail() email!: string;
  @IsString() password!: string;
}
