import { IsString, IsOptional, IsInt, IsNumber, Min, IsDateString, IsNotEmpty } from 'class-validator';

// Provider assigns a product to a customer with its warranty + free-AMC terms.
export class AssignProductDto {
  @IsString() @IsNotEmpty() productId!: string;
  @IsOptional() @IsDateString() purchaseDate?: string;
  @IsOptional() @IsInt() @Min(0) warrantyMonths?: number;
  @IsOptional() @IsInt() @Min(0) freeAmcMonths?: number;
  // Paid-AMC terms that kick in after the free period (shown to the customer).
  @IsOptional() @IsNumber() @Min(0) amcMonthlyCost?: number;
  @IsOptional() @IsInt() @Min(0) amcHoursPerMonth?: number;
  @IsOptional() @IsInt() @Min(0) amcVisitsPerMonth?: number;
}

// Provider edits an existing purchase's terms (no productId — the row is known).
export class UpdateProductTermsDto {
  @IsOptional() @IsDateString() purchaseDate?: string;
  @IsOptional() @IsInt() @Min(0) warrantyMonths?: number;
  @IsOptional() @IsInt() @Min(0) freeAmcMonths?: number;
  @IsOptional() @IsNumber() @Min(0) amcMonthlyCost?: number;
  @IsOptional() @IsInt() @Min(0) amcHoursPerMonth?: number;
  @IsOptional() @IsInt() @Min(0) amcVisitsPerMonth?: number;
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

// Provider grants a request, setting the same terms as a direct assignment.
export class GrantRequestDto {
  @IsOptional() @IsDateString() purchaseDate?: string;
  @IsOptional() @IsInt() @Min(0) warrantyMonths?: number;
  @IsOptional() @IsInt() @Min(0) freeAmcMonths?: number;
  @IsOptional() @IsNumber() @Min(0) amcMonthlyCost?: number;
  @IsOptional() @IsInt() @Min(0) amcHoursPerMonth?: number;
  @IsOptional() @IsInt() @Min(0) amcVisitsPerMonth?: number;
}
