import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ChangeRequestsService } from './change-requests.service';
import { CrRejectDto } from './dto/change-request.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { CustomerAdminGuard } from '../auth/customer-admin.guard';

type AuthedRequest = { user: { id: string; clientId: string; customerCompanyId: string } };

// Customer company admin: review and approve/reject CRs sent to their company.
@UseGuards(JwtAuthGuard, TenantGuard, CustomerAdminGuard)
@Controller('api/my-change-requests')
export class MyChangeRequestsController {
  constructor(private crs: ChangeRequestsService) {}

  @Get()
  list(@Request() req: AuthedRequest) {
    return this.crs.listForCustomer(req.user.clientId, req.user.customerCompanyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.crs.findOneForCustomer(id, req.user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.crs.customerApprove(id, req.user);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: CrRejectDto, @Request() req: AuthedRequest) {
    return this.crs.customerReject(id, dto, req.user);
  }
}
