import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max, IsBoolean } from 'class-validator';

export class UpsertSmtpConfigDto {
  @IsString()
  @IsNotEmpty()
  host: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsBoolean()
  useTls: boolean;

  @IsBoolean()
  enabled: boolean;

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsString()
  @IsNotEmpty()
  fromAddress: string;
}
