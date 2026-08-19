import { IsString, IsOptional, IsInt, IsNumber, Min, IsDateString, IsNotEmpty, IsIn, IsArray, IsBoolean } from 'class-validator';

// Set a company's product contract scope. CUSTOMER carries the shared dates/hours
// + the list of covered products; PRODUCT just flips back to per-product terms.
export class SetContractDto {
  @IsIn(['PRODUCT', 'CUSTOMER']) scope!: 'PRODUCT' | 'CUSTOMER';
  @IsOptional() @IsIn(['WARRANTY', 'AMC']) coverageType?: 'WARRANTY' | 'AMC';
  @IsOptional() @IsDateString() start?: string;
  @IsOptional() @IsDateString() end?: string;
  @IsOptional() @IsInt() @Min(0) hours?: number;
  @IsOptional() @IsInt() @Min(0) visits?: number;
  @IsOptional() @IsNumber() @Min(0) monthlyCost?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
}

// Renew a customer contract into a fresh period (resets the used hours/visits).
export class RenewContractDto {
  @IsInt() @Min(1) months!: number;
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
  @IsOptional() @IsInt() @Min(0) supportHours?: number;
  @IsOptional() @IsInt() @Min(0) visits?: number;
  // AMC (paid) only — the contract amount.
  @IsOptional() @IsNumber() @Min(0) contractAmount?: number;
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
