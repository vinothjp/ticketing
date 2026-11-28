import { IsString, IsOptional, IsEmail, IsInt, Min, Max, IsBoolean, IsIn, IsTimeZone, ValidateIf } from 'class-validator';
import { ISSUE_TYPES } from '../../tickets/auto-assign';

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

  // IANA time zone (`Asia/Kolkata`) ticket emails print their times in.
  @IsOptional()
  @IsTimeZone({ message: 'Pick a valid time zone' })
  timeZone?: string;

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

  // Ticket auto-assignment: open tickets an agent may hold before auto-routing
  // treats them as busy. null = no limit.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt({ message: 'Max open tickets per agent must be a whole number' })
  @Min(1, { message: 'Max open tickets per agent must be at least 1' })
  @Max(1000)
  ticketMaxOpenPerAgent?: number | null;

  // The issue type a ticket with none routes on.
  @IsOptional()
  @IsIn([...ISSUE_TYPES], { message: 'Default issue type must be Technical, Functional or Other' })
  defaultIssueType?: string;

  // Helpdesk email: CC'd on every ticket email. An empty string clears it.
  @IsOptional()
  @ValidateIf((_o, v) => v !== '' && v !== null)
  @IsEmail({}, { message: 'Enter a valid helpdesk email' })
  helpdeskEmail?: string | null;
}
