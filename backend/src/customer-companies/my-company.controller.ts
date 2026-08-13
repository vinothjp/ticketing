import { Controller, Get, Post, Body, Param, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { CustomerCompaniesService } from './customer-companies.service';
import { SupportHoursService } from './support-hours.service';
import { CustomerProductsService } from './customer-products.service';
import { CreateProductRequestDto } from './dto/customer-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; customerCompanyId?: string | null } };

// Customer-facing: products a user may raise a ticket for. A customer sees only
// their own company's products; staff see all. No consultant detail is exposed.
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/my-company')
export class MyCompanyController {
  constructor(
    private service: CustomerCompaniesService,
    private supportHours: SupportHoursService,
    private customerProducts: CustomerProductsService,
  ) {}

  @Get('products')
  products(@Request() req: AuthedRequest) {
    const roles = req.user.roles ?? [];
    const isStaff = roles.includes('Admin') || roles.includes('Viewer');
    return this.service.ticketProducts(req.user.clientId, req.user.customerCompanyId ?? null, isStaff);
  }

  // The signed-in customer's own support-hours usage (drives the ticket banner).
  @Get('support-usage')
  supportUsage(@Request() req: AuthedRequest) {
    if (!req.user.customerCompanyId) return { hasPool: false };
    return this.supportHours.usageForCompanyId(req.user.customerCompanyId, req.user.clientId);
  }

  // ---- Customer product portfolio + requests ----
  private companyId(req: AuthedRequest) {
    if (!req.user.customerCompanyId) throw new BadRequestException('Only customer users have a product portfolio');
    return req.user.customerCompanyId;
  }

  @Get('purchased-products')
  myProducts(@Request() req: AuthedRequest) {
    return this.customerProducts.listMyProducts(req.user.clientId, this.companyId(req));
  }

  @Get('product-catalogue')
  catalogue(@Request() req: AuthedRequest) {
    return this.customerProducts.requestableProducts(req.user.clientId, this.companyId(req));
  }

  @Get('product-requests')
  myRequests(@Request() req: AuthedRequest) {
    return this.customerProducts.listMyRequests(this.companyId(req), req.user.clientId);
  }

  @Post('product-requests')
  requestProduct(@Body() dto: CreateProductRequestDto, @Request() req: AuthedRequest) {
    return this.customerProducts.createRequest(req.user.clientId, this.companyId(req), dto, req.user.id);
  }

  @Post('purchased-products/:cpId/request-renewal')
  requestRenewal(@Param('cpId') cpId: string, @Request() req: AuthedRequest) {
    return this.customerProducts.requestRenewal(cpId, req.user.clientId, this.companyId(req));
  }
}
