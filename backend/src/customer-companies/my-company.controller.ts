import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { CustomerCompaniesService } from './customer-companies.service';
import { SupportHoursService } from './support-hours.service';
import { CustomerProductsService } from './customer-products.service';
import { CreateProductRequestDto } from './dto/customer-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { StaffGuard } from '../auth/staff.guard';

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

  // Scoped to one customer company: a customer always gets their own, staff pass
  // the client they picked on the ticket form.
  @Get('products')
  products(@Request() req: AuthedRequest, @Query('customerCompanyId') customerCompanyId?: string) {
    const roles = req.user.roles ?? [];
    const isStaff = roles.includes('Admin') || roles.includes('Viewer');
    const companyId = isStaff ? customerCompanyId || null : (req.user.customerCompanyId ?? null);
    // Staff who picked no client are raising an INTERNAL ticket — there is no
    // customer contract to scope the list, so they get the tenant's catalogue.
    // A customer with no company still gets nothing.
    if (isStaff && !companyId) return this.service.internalTicketProducts(req.user.clientId);
    return this.service.ticketProducts(req.user.clientId, companyId);
  }

  // Clients an agent may raise a ticket for. Admins already have the full list at
  // `api/customer-companies`, but that route is Admin-only — a Viewer needs the
  // names to pick a client (and therefore a product) on the ticket form.
  @Get('clients')
  @UseGuards(StaffGuard)
  clients(@Request() req: AuthedRequest) {
    return this.service.ticketClients(req.user.clientId);
  }

  // Read-only support-hours pool for one product, shown on the ticket form as soon
  // as a product is picked. Deliberately on this controller so every side sees the
  // same number: provider admin, agent, customer admin and customer contact.
  @Get('product-support-hours')
  productSupportHours(
    @Request() req: AuthedRequest,
    @Query('productId') productId?: string,
    @Query('customerCompanyId') customerCompanyId?: string,
  ) {
    const roles = req.user.roles ?? [];
    const isStaff = roles.includes('Admin') || roles.includes('Viewer');
    const companyId = isStaff ? customerCompanyId || null : (req.user.customerCompanyId ?? null);
    const empty = { hasPool: false as const, allocated: null, used: 0, left: null };
    if (!companyId || !productId) return empty;
    return this.customerProducts.productSupportHours(req.user.clientId, companyId, productId);
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

  @Get('product-contract')
  myContract(@Request() req: AuthedRequest) {
    return this.customerProducts.myContract(this.companyId(req), req.user.clientId);
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
