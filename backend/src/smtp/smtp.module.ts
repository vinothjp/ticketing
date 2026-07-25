import { Module } from '@nestjs/common';
import { SmtpService } from './smtp.service';
import { SmtpController } from './smtp.controller';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  providers: [SmtpService],
  controllers: [SmtpController],
})
export class SmtpModule {}
