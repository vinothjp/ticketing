import { IsString, IsOptional, IsEmail, IsInt, Min, Max } from 'class-validator';

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

  // Days after resolution during which a ticket may still be reopened. Defaults
  // to 30; past the window the ticket screen tells the user to raise a new one.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  ticketReopenWindowDays?: number;

  // Days a resolved ticket waits for the client's acknowledgement before it
  // closes itself. Defaults to 3.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  ticketAutoCloseDays?: number;
}
