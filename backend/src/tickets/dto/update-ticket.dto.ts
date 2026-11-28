import {
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateTicketDto {
  @IsOptional() @IsString() ticketStatus?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() ticketCategory?: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsDateString() expectedResolutionDate?: string;

  @IsOptional() @IsObject() customFields?: Record<string, unknown>;

  /**
   * What the client is asked for when a client ticket moves to "Awaiting
   * End-user Response" — required then; emailed to them (Additional Information
   * Requested) and posted into the ticket's chat.
   */
  @IsOptional() @IsString() @MaxLength(4000) requestedInformation?: string;
}
