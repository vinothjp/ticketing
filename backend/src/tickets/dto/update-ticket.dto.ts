import {
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateTicketDto {
  @IsOptional() @IsString() ticketStatus?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() ticketCategory?: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsDateString() expectedResolutionDate?: string;

  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
