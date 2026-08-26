import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { RequestApprovalDto, DecideApprovalDto, UpdateApprovalDto } from './dto/approval.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { StaffGuard } from '../auth/staff.guard';

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
  @UseGuards(StaffGuard)
  request(@Param('ticketId') ticketId: string, @Body() dto: RequestApprovalDto, @Request() req: AuthedRequest) {
    return this.approvalsService.request(ticketId, req.user.clientId, dto, req.user, req.user);
  }

  // Edit / withdraw the request. The service — not the guard — decides who may:
  // a tenant Admin or the agent the ticket is assigned to. StaffGuard alone would
  // let any agent rewrite a request on a ticket they merely can see.
  @Patch('approvals/:id')
  @UseGuards(StaffGuard)
  update(@Param('id') id: string, @Body() dto: UpdateApprovalDto, @Request() req: AuthedRequest) {
    return this.approvalsService.update(id, req.user.clientId, dto, req.user);
  }

  @Delete('approvals/:id')
  @UseGuards(StaffGuard)
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.approvalsService.remove(id, req.user.clientId, req.user);
  }

  @Post('approvals/:id/decision')
  @UseGuards(StaffGuard)
  decide(@Param('id') id: string, @Body() dto: DecideApprovalDto, @Request() req: AuthedRequest) {
    return this.approvalsService.decide(id, req.user.clientId, dto, req.user.id);
  }
}
