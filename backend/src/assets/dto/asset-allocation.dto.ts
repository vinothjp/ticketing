import { IsOptional, IsString, IsNotEmpty, IsIn, IsDateString } from 'class-validator';
import { ALLOCATION_STATUSES, RETURN_CONDITIONS, RETENTIONS } from '../allocation-status';

export class CreateAssetAllocationDto {
  @IsString() @IsNotEmpty() assetId!: string;
  @IsString() @IsNotEmpty() employeeUserId!: string;

  @IsOptional() @IsIn(ALLOCATION_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsIn(RETURN_CONDITIONS as unknown as string[]) returnCondition?: string | null;
  @IsOptional() @IsIn(RETENTIONS as unknown as string[]) retention?: string;
  @IsOptional() @IsDateString() expectedReturnDate?: string | null;
  @IsOptional() @IsDateString() issuedDate?: string | null;
  @IsOptional() @IsDateString() returnDate?: string | null;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateAssetAllocationDto {
  @IsOptional() @IsString() @IsNotEmpty() assetId?: string;
  @IsOptional() @IsString() @IsNotEmpty() employeeUserId?: string;

  @IsOptional() @IsIn(ALLOCATION_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsIn(RETURN_CONDITIONS as unknown as string[]) returnCondition?: string | null;
  @IsOptional() @IsIn(RETENTIONS as unknown as string[]) retention?: string;
  @IsOptional() @IsDateString() expectedReturnDate?: string | null;
  @IsOptional() @IsDateString() issuedDate?: string | null;
  @IsOptional() @IsDateString() returnDate?: string | null;
  @IsOptional() @IsString() notes?: string;
}
