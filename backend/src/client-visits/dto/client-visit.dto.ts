import {
  IsDateString, IsIn, IsNumber, IsOptional, IsString,
} from 'class-validator';

/**
 * Where a visit is *now*. Being rescheduled is two states, not one:
 * `RESCHEDULE_REQUESTED` is the consultant asking and waiting on an admin date;
 * once the admin sets one the visit goes back to `PLANNED` and its history is
 * carried by `rescheduleCount` instead of by the status.
 */
export const VISIT_STATUSES = ['PLANNED', 'VISITED', 'RESCHEDULE_REQUESTED'] as const;

/** Human wording for notification copy — statuses are SCREAMING_SNAKE on the wire. */
export const VISIT_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'planned',
  VISITED: 'visited',
  RESCHEDULE_REQUESTED: 'reschedule requested',
};

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
