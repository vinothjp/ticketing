import { IsOptional, IsString, IsNotEmpty, IsIn, IsDateString } from 'class-validator';
import { ASSET_CONDITIONS } from '../allocation-status';

/**
 * Every descriptive field on an asset is free text by design — the Asset Master
 * form has no dropdowns. Only the three dates and `condition` are typed, and the
 * dates arrive as `YYYY-MM-DD` from the form's date inputs.
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
  @IsOptional() @IsIn(ASSET_CONDITIONS as unknown as string[]) condition?: string;

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
  @IsOptional() @IsIn(ASSET_CONDITIONS as unknown as string[]) condition?: string;

  @IsOptional() @IsDateString() warrantyStart?: string | null;
  @IsOptional() @IsDateString() warrantyEnd?: string | null;
  @IsOptional() @IsDateString() purchaseDate?: string | null;
}
