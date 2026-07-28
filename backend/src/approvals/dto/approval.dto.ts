import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RequestApprovalDto {
  @IsString() @IsNotEmpty() approverUserId: string;
  @IsOptional() @IsString() comment?: string;
}

export class DecideApprovalDto {
  @IsIn(['APPROVED', 'REJECTED']) status: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() comment?: string;
}
