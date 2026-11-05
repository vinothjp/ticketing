import { Body, Controller, Get, Put, UseGuards, Request } from '@nestjs/common';
import { ChannelConfigService } from './channel-config.service';
import type { UpsertChannelDto } from './channel-config.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin')
@Controller('api/messaging-channels')
export class ChannelsController {
  constructor(private config: ChannelConfigService) {}

  @Get()
  list(@Request() req: AuthedRequest) {
    return this.config.list(req.user.clientId);
  }

  @Put()
  upsert(@Body() dto: UpsertChannelDto, @Request() req: AuthedRequest) {
    return this.config.upsert(req.user.clientId, dto, req.user.id);
  }
}
