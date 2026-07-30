import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateTicketDto {
  @IsOptional() @IsString() ticketStatus?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() ticketCategory?: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsDateString() expectedResolutionDate?: string;
  @IsOptional() @IsBoolean() customerConfirmation?: boolean;

  @IsOptional() @IsString() rootCauseCategory?: string;
  @IsOptional() @IsString() rootCauseDescription?: string;
  @IsOptional() @IsString() correctionAction?: string;
  @IsOptional() @IsString() preventionAction?: string;
  @IsOptional() @IsString() lessonsLearned?: string;
}
