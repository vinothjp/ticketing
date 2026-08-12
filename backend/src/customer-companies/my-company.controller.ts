import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { CustomerCompaniesService } from './customer-companies.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { clientId: string; roles: string[]; customerCompanyId?: string | null } };

// Customer-facing: products a user may raise a ticket for. A customer sees only
// their own company's products; staff see all. No consultant detail is exposed.
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/my-company')
export class MyCompanyController {
  constructor(private service: CustomerCompaniesService) {}

  @Get('products')
  products(@Request() req: AuthedRequest) {
    const roles = req.user.roles ?? [];
    const isStaff = roles.includes('Admin') || roles.includes('Viewer');
    return this.service.ticketProducts(req.user.clientId, req.user.customerCompanyId ?? null, isStaff);
  }
}
