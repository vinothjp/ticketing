import { IsString, IsOptional, IsEmail, IsInt, Min, Max, IsBoolean, ValidateIf } from 'class-validator';

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

  // How many times one ticket may be reopened. Defaults to 3; 0 means a
  // resolved ticket is never reopened and the user raises a new one.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ticketMaxReopens?: number;

  // Token pattern every date on the ticket screens is rendered with. Picked from
  // the DATE_FORMAT option list, so it is validated as free text here rather
  // than against a fixed enum — an admin may add a pattern of their own.
  @IsOptional()
  @IsString()
  dateFormat?: string;

  // Clock appended to `dateFormat` wherever a date-and-time stamp is shown.
  // Picked from the TIME_FORMAT option list.
  @IsOptional()
  @IsString()
  timeFormat?: string;

  // The currency the organization trades in, from the CURRENCY option list.
  // Stored config — no screen reads it yet.
  @IsOptional()
  @IsString()
  currency?: string;

  // Critical ticket admin: the address every Critical ticket is emailed to, and
  // the switch for it. An empty string clears the address; switching on without
  // one is refused by the service.
  @IsOptional()
  @ValidateIf((_o, v) => v !== '' && v !== null)
  @IsEmail({}, { message: 'Enter a valid critical ticket admin email' })
  criticalTicketEmail?: string | null;

  @IsOptional()
  @IsBoolean()
  criticalTicketAlerts?: boolean;
}
