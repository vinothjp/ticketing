import { IsOptional, IsString } from 'class-validator';

export class SetResolutionDto {
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsString() resolutionCode?: string;
  @IsOptional() @IsString() ticketStatus?: string;
}
