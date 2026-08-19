import {
  IsDateString, IsIn, IsNumber, IsOptional, IsString,
} from 'class-validator';

export const VISIT_STATUSES = ['PLANNED', 'VISITED', 'RESCHEDULED'] as const;

export class CreateClientVisitDto {
  @IsDateString() visitDate!: string;
  @IsString() customerCompanyId!: string;
  @IsString() consultantId!: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsNumber() hours?: number;
  @IsString() purpose!: string;
  @IsOptional() @IsString() notes?: string;
  @IsIn(VISIT_STATUSES as unknown as string[]) status!: string;
  @IsOptional() @IsString() ticketId?: string;
}

export class UpdateClientVisitDto {
  @IsOptional() @IsDateString() visitDate?: string;
  @IsOptional() @IsString() customerCompanyId?: string;
  @IsOptional() @IsString() consultantId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsNumber() hours?: number;
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(VISIT_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() ticketId?: string;
}
