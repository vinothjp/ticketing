import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  requestTypeId: string;

  @IsOptional() @IsString() requestorName?: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() requestorContact?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() ticketCategory?: string;
  @IsOptional() @IsString() subCategory?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  technicianUserIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  notifyEmails?: string[];

  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsDateString() expectedResolutionDate?: string;
  @IsOptional() @IsBoolean() customerConfirmation?: boolean;

  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() description?: string;

  @IsOptional() @IsString() rootCauseCategory?: string;
  @IsOptional() @IsString() rootCauseDescription?: string;
  @IsOptional() @IsString() correctionAction?: string;
  @IsOptional() @IsString() preventionAction?: string;
  @IsOptional() @IsString() lessonsLearned?: string;
}
