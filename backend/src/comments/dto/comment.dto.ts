import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCommentDto {
  @IsString() @IsNotEmpty() body: string;
  /** Omit for a comment on the ticket itself; set to comment on one of its tasks. */
  @IsOptional() @IsString() taskId?: string;
}
