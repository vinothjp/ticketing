import { IsString, IsNotEmpty } from 'class-validator';

export class RejectTicketDto {
  @IsString() @IsNotEmpty() reason!: string;
}
