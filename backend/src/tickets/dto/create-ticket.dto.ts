import {
  IsArray,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @IsOptional() @IsString() requestorName?: string;
  @IsOptional() @IsString() requestorEmail?: string;
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

  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() description?: string;

  /** Admin-designed custom field values, keyed by TemplateField.fieldKey. */
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}
