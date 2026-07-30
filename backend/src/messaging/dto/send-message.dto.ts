import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SendMessageDto {
  @IsIn(['EMAIL', 'INTERNAL'])
  channel: 'EMAIL' | 'INTERNAL';

  @IsString()
  @IsNotEmpty()
  body: string;
}
