import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * A ticket approval is an **asset request**: the row names the asset being asked
 * for, and approving it issues that asset to whoever raised the request. The
 * asset fields are optional so a plain sign-off with no asset still works.
 */
export class RequestApprovalDto {
  @IsString() @IsNotEmpty() approverUserId: string;
  @IsOptional() @IsString() comment?: string;

  @IsOptional() @IsString() @IsNotEmpty() assetId?: string;
  @IsOptional() @IsString() assetType?: string;
}

export class DecideApprovalDto {
  @IsIn(['APPROVED', 'REJECTED']) status: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() comment?: string;
}

export class UpdateApprovalDto {
  @IsOptional() @IsString() @IsNotEmpty() approverUserId?: string;
  @IsOptional() @IsString() comment?: string;

  // null clears the asset, turning the row back into a plain approval request.
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @IsNotEmpty() assetId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() assetType?: string | null;
}
