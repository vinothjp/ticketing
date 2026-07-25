import { Controller, Get, Put, Post, Body, Request, UseGuards } from '@nestjs/common';
import { SmtpService } from './smtp.service';
import { UpsertSmtpConfigDto } from './dto/upsert-smtp-config.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string } };

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SuperAdmin')
@Controller('api/super-admin/smtp-config')
export class SmtpController {
  constructor(private smtpService: SmtpService) {}

  @Get()
  getConfig() { return this.smtpService.getConfig(); }

  @Put()
  upsertConfig(@Body() dto: UpsertSmtpConfigDto, @Request() req: AuthedRequest) {
    return this.smtpService.upsertConfig(dto, req.user.id);
  }

  @Post('test')
  testConnection() { return this.smtpService.testConnection(); }
}
