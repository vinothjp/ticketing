import { IsString, IsOptional, IsInt, IsNumber, Min, IsDateString, IsNotEmpty, IsIn, IsArray, IsBoolean } from 'class-validator';

// Set a company's product contract scope. CUSTOMER carries the shared dates/hours
// + the list of covered products; PRODUCT just flips back to per-product terms.
/**
 * Every term is optional and nullable, and the two mean different things in
 * `setContract`: an ABSENT field is left as it is, an explicit `null` clears it.
 * That split is what lets the Contract type switch send the scope on its own
 * without wiping the terms the client already has.
 */
export class SetContractDto {
  @IsIn(['PRODUCT', 'CUSTOMER']) scope!: 'PRODUCT' | 'CUSTOMER';
  @IsOptional() @IsIn(['WARRANTY', 'AMC']) coverageType?: 'WARRANTY' | 'AMC';
  @IsOptional() @IsDateString() start?: string | null;
  @IsOptional() @IsDateString() end?: string | null;
  // Support hours are either Unlimited (no cap, nothing deducted) or Limited,
  // in which case `hours` is required and must be greater than zero.
  @IsOptional() @IsBoolean() hoursUnlimited?: boolean;
  @IsOptional() @IsInt() @Min(0) hours?: number | null;
  @IsOptional() @IsInt() @Min(0) visits?: number | null;
  @IsOptional() @IsNumber() @Min(0) monthlyCost?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
  // Support-hours config. `hoursPeriod` reads `hours` as a whole-term pool
  // (FULL_AMC) or a per-month allowance (MONTHLY); `carryForward` rolls unused
  // monthly hours over; `allowExcess`/`excessApproval` gate logging past the
  // allowance; `excessApproverId` names the staff approver (null clears it).
  @IsOptional() @IsIn(['FULL_AMC', 'MONTHLY']) hoursPeriod?: 'FULL_AMC' | 'MONTHLY';
  @IsOptional() @IsBoolean() carryForward?: boolean;
  @IsOptional() @IsBoolean() allowExcess?: boolean;
  @IsOptional() @IsBoolean() excessApproval?: boolean;
  @IsOptional() @IsString() excessApproverId?: string | null;
  // Whether the customer may still raise tickets once the allowance is spent.
  @IsOptional() @IsBoolean() allowTicketsAfterHours?: boolean;
}

/**
 * The purchase order a contract was raised against. Its own DTO and its own
 * endpoint, deliberately NOT part of the terms above: the PO and its invoice are
 * paperwork attached to the contract, not terms of it, and they save the moment
 * they are typed rather than waiting for a Save press. Keeping them out of the
 * terms payload is what stops a stale form value overwriting a PO just entered.
 */
export class SetPoNumberDto {
  @IsOptional() @IsString() poNumber?: string | null;
}

// Renew a customer contract into a fresh period (resets the used hours/visits).
export class RenewContractDto {
  @IsInt() @Min(1) months!: number;
  @IsOptional() @IsBoolean() hoursUnlimited?: boolean;
  @IsOptional() @IsInt() @Min(0) hours?: number;
  @IsOptional() @IsInt() @Min(0) visits?: number;
  @IsOptional() @IsNumber() @Min(0) monthlyCost?: number;
}

// Coverage is ONE timeline picked by `coverageType`: Warranty (free) OR AMC (paid).
// Terms are a single date range + support-hours + visits; AMC adds a contract amount.
class ProductTermsFields {
  @IsOptional() @IsIn(['WARRANTY', 'AMC']) coverageType?: 'WARRANTY' | 'AMC';
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  // Unlimited = no support-hours cap for this coverage (nothing deducted or
  // alerted on); Limited requires `supportHours` greater than zero.
  @IsOptional() @IsBoolean() supportHoursUnlimited?: boolean;
  @IsOptional() @IsInt() @Min(0) supportHours?: number;
  @IsOptional() @IsInt() @Min(0) visits?: number;
  // AMC (paid) only — the contract amount.
  @IsOptional() @IsNumber() @Min(0) contractAmount?: number;
  // Per-product support-hours config — same meaning as SetContractDto, applied to
  // the product's active (paid/free) pool.
  @IsOptional() @IsIn(['FULL_AMC', 'MONTHLY']) hoursPeriod?: 'FULL_AMC' | 'MONTHLY';
  @IsOptional() @IsBoolean() carryForward?: boolean;
  @IsOptional() @IsBoolean() allowExcess?: boolean;
  @IsOptional() @IsBoolean() excessApproval?: boolean;
  @IsOptional() @IsString() excessApproverId?: string | null;
  @IsOptional() @IsBoolean() allowTicketsAfterHours?: boolean;
}

// Provider assigns a product to a customer.
export class AssignProductDto extends ProductTermsFields {
  @IsString() @IsNotEmpty() productId!: string;
}

// Provider edits an existing purchase's terms (row already known).
export class UpdateProductTermsDto extends ProductTermsFields {}

// Provider records support-hours / a site visit used against the AMC period.
export class LogUsageDto {
  @IsOptional() @IsNumber() @Min(0) hours?: number;
  @IsOptional() @IsInt() @Min(0) visits?: number;
}

// Provider renews a customer's AMC into a paid period.
export class RenewAmcDto {
  @IsInt() @Min(1) months!: number;
  @IsOptional() @IsNumber() @Min(0) amcMonthlyCost?: number;
  @IsOptional() @IsBoolean() amcHoursUnlimited?: boolean;
  @IsOptional() @IsInt() @Min(0) amcHoursPerMonth?: number;
  @IsOptional() @IsInt() @Min(0) amcVisitsPerMonth?: number;
}

// Customer requests a new product from the provider's catalogue.
export class CreateProductRequestDto {
  @IsString() @IsNotEmpty() productId!: string;
  @IsOptional() @IsString() note?: string;
}

export class DeclineRequestDto {
  @IsOptional() @IsString() note?: string;
}

// Attach a consultant to a customer for auto-assignment. Omit product/module for
// the customer's default consultant.
export class AddCustomerConsultantDto {
  @IsString() @IsNotEmpty() userId!: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() moduleId?: string;
  @IsOptional() @IsIn(['TECHNICAL', 'FUNCTIONAL']) track?: 'TECHNICAL' | 'FUNCTIONAL';
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

// Provider grants a request, setting the same terms as a direct assignment.
export class GrantRequestDto extends ProductTermsFields {}

/** Approver's optional note when deciding an excess support-hours request. */
export class DecideExcessDto {
  @IsOptional() @IsString() note?: string;
}
