import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { NotificationRulesService } from './notification-rules.service';
import { SaveNotificationRulesDto } from './dto/save-notification-rules.dto';

type AuthedRequest = { user: { id: string; clientId: string } };

/** Email Configuration screen — tenant Admins only. */
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin')
@Controller('api/notification-rules')
export class NotificationRulesController {
  constructor(private service: NotificationRulesService) {}

  @Get()
  list(@Request() req: AuthedRequest) {
    return this.service.list(req.user.clientId);
  }

  @Put()
  save(@Request() req: AuthedRequest, @Body() dto: SaveNotificationRulesDto) {
    return this.service.save(req.user.clientId, dto.rules);
  }
}
