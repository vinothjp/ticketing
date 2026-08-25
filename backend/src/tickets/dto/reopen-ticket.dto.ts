import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * Reopening always carries a reason: it's the client telling the agents what the
 * resolution missed, and it's pushed to them as a notification.
 */
export class ReopenTicketDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
}
