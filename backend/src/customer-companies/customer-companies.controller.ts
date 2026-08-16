import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, Request,
} from '@nestjs/common';
import { CustomerCompaniesService } from './customer-companies.service';
import { SupportHoursService } from './support-hours.service';
import { CustomerProductsService } from './customer-products.service';
import { CreateCompanyDto, UpdateCompanyDto, CreateContactDto } from './dto/customer-company.dto';
import {
  AssignProductDto, UpdateProductTermsDto, RenewAmcDto, GrantRequestDto, DeclineRequestDto, SetContractDto,
  RenewContractDto, AddCustomerConsultantDto, LogUsageDto,
} from './dto/customer-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { StaffGuard } from '../auth/staff.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/customer-companies')
export class CustomerCompaniesController {
  constructor(
    private service: CustomerCompaniesService,
    private supportHours: SupportHoursService,
    private customerProducts: CustomerProductsService,
  ) {}

  // ---- Provider: product requests queue (declared before :id routes) ----
  @Get('product-requests')
  @Roles('Admin')
  listProductRequests(@Request() req: AuthedRequest) {
    return this.customerProducts.listRequests(req.user.clientId);
  }

  // Manual "check coverage now" — the timer also runs this on a schedule.
  @Post('amc/run-sweep')
  @Roles('Admin')
  runAmcSweep() {
    return this.customerProducts.runExpirySweep();
  }

  @Post('product-requests/:reqId/grant')
  @Roles('Admin')
  grantProductRequest(@Param('reqId') reqId: string, @Body() dto: GrantRequestDto, @Request() req: AuthedRequest) {
    return this.customerProducts.grantRequest(reqId, dto, req.user.clientId, req.user.id);
  }

  @Post('product-requests/:reqId/decline')
  @Roles('Admin')
  declineProductRequest(@Param('reqId') reqId: string, @Body() dto: DeclineRequestDto, @Request() req: AuthedRequest) {
    return this.customerProducts.declineRequest(reqId, dto.note, req.user.clientId, req.user.id);
  }

  // ---- Provider: a company's purchased products + AMC/warranty terms ----
  @Get(':id/product-contract')
  @Roles('Admin')
  getContract(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.customerProducts.getContract(id, req.user.clientId);
  }

  @Put(':id/product-contract')
  @Roles('Admin')
  setContract(@Param('id') id: string, @Body() dto: SetContractDto, @Request() req: AuthedRequest) {
    return this.customerProducts.setContract(id, dto, req.user.clientId);
  }

  @Post(':id/contract-usage')
  @Roles('Admin')
  logContractUsage(@Param('id') id: string, @Body() dto: LogUsageDto, @Request() req: AuthedRequest) {
    return this.customerProducts.logContractUsage(id, dto, req.user.clientId);
  }

  @Post(':id/contract-renew')
  @Roles('Admin')
  renewContract(@Param('id') id: string, @Body() dto: RenewContractDto, @Request() req: AuthedRequest) {
    return this.customerProducts.renewContract(id, dto, req.user.clientId);
  }

  @Get(':id/purchased-products')
  @Roles('Admin')
  purchasedProducts(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.customerProducts.listCompanyProducts(id, req.user.clientId);
  }

  @Post(':id/purchased-products')
  @Roles('Admin')
  assignProduct(@Param('id') id: string, @Body() dto: AssignProductDto, @Request() req: AuthedRequest) {
    return this.customerProducts.assignProduct(id, dto, req.user.clientId);
  }

  @Patch('purchased-products/:cpId')
  @Roles('Admin')
  updateProductTerms(@Param('cpId') cpId: string, @Body() dto: UpdateProductTermsDto, @Request() req: AuthedRequest) {
    return this.customerProducts.updateTerms(cpId, dto, req.user.clientId);
  }

  @Post('purchased-products/:cpId/renew')
  @Roles('Admin')
  renewAmc(@Param('cpId') cpId: string, @Body() dto: RenewAmcDto, @Request() req: AuthedRequest) {
    return this.customerProducts.renewAmc(cpId, dto, req.user.clientId);
  }

  @Post('purchased-products/:cpId/usage')
  @Roles('Admin')
  logUsage(@Param('cpId') cpId: string, @Body() dto: LogUsageDto, @Request() req: AuthedRequest) {
    return this.customerProducts.logUsage(cpId, dto, req.user.clientId);
  }

  @Delete('purchased-products/:cpId')
  @Roles('Admin')
  removePurchasedProduct(@Param('cpId') cpId: string, @Request() req: AuthedRequest) {
    return this.customerProducts.removeProduct(cpId, req.user.clientId);
  }

  // ---- Provider: customer-level consultants (auto-assignment overrides) ----
  @Get(':id/consultants')
  @Roles('Admin')
  listConsultants(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.customerProducts.listCustomerConsultants(id, req.user.clientId);
  }

  @Post(':id/consultants')
  @Roles('Admin')
  addConsultant(@Param('id') id: string, @Body() dto: AddCustomerConsultantDto, @Request() req: AuthedRequest) {
    return this.customerProducts.addCustomerConsultant(id, dto, req.user.clientId);
  }

  @Delete('consultants/:ccId')
  @Roles('Admin')
  removeCustomerConsultant(@Param('ccId') ccId: string, @Request() req: AuthedRequest) {
    return this.customerProducts.removeCustomerConsultant(ccId, req.user.clientId);
  }

  // One client's core details (declared last so it doesn't shadow static routes).
  @Get(':id')
  @Roles('Admin')
  getOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.getOne(id, req.user.clientId);
  }

  // Any authenticated staff member may list companies (needed for the ticket
  // filter). StaffGuard blocks customers — a customer must not see the tenant's
  // other client companies.
  @Get()
  @UseGuards(StaffGuard)
  list(@Request() req: AuthedRequest) {
    return this.service.list(req.user.clientId);
  }

  @Post()
  @Roles('Admin')
  create(@Body() dto: CreateCompanyDto, @Request() req: AuthedRequest) {
    return this.service.create(dto, req.user.clientId, req.user.id);
  }

  @Patch(':id')
  @Roles('Admin')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto, @Request() req: AuthedRequest) {
    return this.service.update(id, dto, req.user.clientId, req.user.id);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.remove(id, req.user.clientId);
  }

  @Get(':id/products')
  @Roles('Admin')
  getProducts(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.getProducts(id, req.user.clientId);
  }

  // Support-hours usage for one company (staff — e.g. the ticket create banner).
  @Get(':id/support-usage')
  @UseGuards(StaffGuard)
  supportUsage(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.supportHours.usageForCompanyId(id, req.user.clientId);
  }

  @Get(':id/contacts')
  @Roles('Admin')
  listContacts(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.listContacts(id, req.user.clientId);
  }

  @Post(':id/contacts')
  @Roles('Admin')
  addContact(@Param('id') id: string, @Body() dto: CreateContactDto, @Request() req: AuthedRequest) {
    return this.service.addContact(id, dto, req.user.clientId, req.user.id);
  }

  @Delete(':id/contacts/:userId')
  @Roles('Admin')
  removeContact(@Param('id') id: string, @Param('userId') userId: string, @Request() req: AuthedRequest) {
    return this.service.removeContact(id, userId, req.user.clientId);
  }
}
