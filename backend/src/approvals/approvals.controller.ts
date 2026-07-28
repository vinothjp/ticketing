import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { RequestApprovalDto, DecideApprovalDto } from './dto/approval.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api')
export class ApprovalsController {
  constructor(private approvalsService: ApprovalsService) {}

  @Get('tickets/:ticketId/approvals')
  list(@Param('ticketId') ticketId: string, @Request() req: AuthedRequest) {
    return this.approvalsService.list(ticketId, req.user.clientId, req.user);
  }

  @Post('tickets/:ticketId/approvals')
  request(@Param('ticketId') ticketId: string, @Body() dto: RequestApprovalDto, @Request() req: AuthedRequest) {
    return this.approvalsService.request(ticketId, req.user.clientId, dto, req.user, req.user);
  }

  @Post('approvals/:id/decision')
  decide(@Param('id') id: string, @Body() dto: DecideApprovalDto, @Request() req: AuthedRequest) {
    return this.approvalsService.decide(id, req.user.clientId, dto, req.user.id);
  }
}
