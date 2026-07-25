import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateFormDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  displayName: string;

  @IsOptional()
  @IsString()
  description?: string;
}
