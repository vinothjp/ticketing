import { IsOptional, IsString, IsNotEmpty, IsDateString } from 'class-validator';

/**
 * Every descriptive field on an asset is free text by design — the Asset Master
 * form has no dropdowns. Only the three dates are typed, and they arrive as
 * `YYYY-MM-DD` from the form's date inputs.
 */
export class CreateAssetDto {
  @IsString() @IsNotEmpty() assetId!: string;
  @IsString() @IsNotEmpty() assetName!: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() assetType?: string;
  @IsOptional() @IsString() assetCategory?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() poNumber?: string;
  @IsOptional() @IsString() supplierName?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsString() lifespan?: string;

  @IsOptional() @IsDateString() warrantyStart?: string | null;
  @IsOptional() @IsDateString() warrantyEnd?: string | null;
  @IsOptional() @IsDateString() purchaseDate?: string | null;
}

export class UpdateAssetDto {
  @IsOptional() @IsString() @IsNotEmpty() assetId?: string;
  @IsOptional() @IsString() @IsNotEmpty() assetName?: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() assetType?: string;
  @IsOptional() @IsString() assetCategory?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() poNumber?: string;
  @IsOptional() @IsString() supplierName?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsString() lifespan?: string;

  @IsOptional() @IsDateString() warrantyStart?: string | null;
  @IsOptional() @IsDateString() warrantyEnd?: string | null;
  @IsOptional() @IsDateString() purchaseDate?: string | null;
}
