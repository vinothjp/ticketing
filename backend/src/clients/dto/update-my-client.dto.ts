import { IsString, IsOptional, IsEmail } from 'class-validator';

export class UpdateMyClientDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;
}
