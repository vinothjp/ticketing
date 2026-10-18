import { IsOptional, IsString, IsInt, IsNumber, Min, Max, IsEmail, IsArray, IsDateString, IsBoolean, MinLength } from 'class-validator';

// Agreed support-hours pool. Shared by create + update so both validate the same way.
class SupportHoursFields {
  @IsOptional() @IsNumber() @Min(0) agreedSupportHours?: number;
  @IsOptional() @IsDateString() supportPeriodStart?: string;
  @IsOptional() @IsDateString() supportPeriodEnd?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) supportAlertThresholdPct?: number;
}

export class CreateCompanyDto extends SupportHoursFields {
  @IsString() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() contactNumber?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxContacts?: number;
  @IsOptional() @IsString() status?: string;
  // Products this company uses (limits what they can raise tickets for).
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
  // The client's one CustomerAdmin: either a new login (the three fields) or an
  // existing, unlinked CustomerAdmin (`adminUserId`). Required from the New
  // Client form; the import creates clients without one. After this hand-off,
  // all further user management is done by the customer themselves.
  @IsOptional() @IsString() adminUsername?: string;
  @IsOptional() @IsEmail() adminEmail?: string;
  @IsOptional() @IsString() @MinLength(6) adminPassword?: string;
  @IsOptional() @IsString() adminUserId?: string;
}

/** Gives an existing, admin-less client its admin — the same two modes as on create. */
export class CustomerAdminDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MinLength(6) password?: string;
}

export class UpdateCompanyDto extends SupportHoursFields {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() contactNumber?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxContacts?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
  // Whether tickets this client raises are auto-routed to a free consultant.
  // Scope-independent, so it is written here rather than through SetContractDto,
  // whose settings block only runs for a CUSTOMER-scope contract.
  @IsOptional() @IsBoolean() autoAssignTickets?: boolean;
}

export class CreateContactDto {
  @IsString() username!: string;
  @IsEmail() email!: string;
  @IsString() password!: string;
}
