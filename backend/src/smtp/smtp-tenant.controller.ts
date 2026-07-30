import { Controller, Get, Put, Post, Body, Request, UseGuards } from '@nestjs/common';
import { SmtpService } from './smtp.service';
import { UpsertSmtpConfigDto } from './dto/upsert-smtp-config.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

// Tenant-level SMTP: each organization manages its own outgoing mail.
// Admins and Agents (Viewer) may edit; customers are excluded by RolesGuard.
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin', 'Viewer')
@Controller('api/smtp-config')
export class SmtpTenantController {
  constructor(private smtpService: SmtpService) {}

  @Get()
  getConfig(@Request() req: AuthedRequest) {
    return this.smtpService.getConfig(req.user.clientId);
  }

  @Put()
  upsertConfig(@Body() dto: UpsertSmtpConfigDto, @Request() req: AuthedRequest) {
    return this.smtpService.upsertConfig(dto, req.user.id, req.user.clientId);
  }

  @Post('test')
  testConnection(@Request() req: AuthedRequest) {
    return this.smtpService.testConnection(req.user.clientId);
  }
}
