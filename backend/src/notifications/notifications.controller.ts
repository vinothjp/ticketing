import { Controller, Get, Post, Param, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

type AuthedRequest = { user: { id: string } };

// Every authenticated user has their own notification feed.
@UseGuards(JwtAuthGuard)
@Controller('api/notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  list(@Request() req: AuthedRequest) {
    return this.service.listMine(req.user.id);
  }

  @Post(':id/read')
  markRead(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.markRead(id, req.user.id);
  }

  @Post('read-all')
  markAllRead(@Request() req: AuthedRequest) {
    return this.service.markAllRead(req.user.id);
  }
}
