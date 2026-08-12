import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request,
} from '@nestjs/common';
import { CustomerCompaniesService } from './customer-companies.service';
import { CreateCompanyDto, UpdateCompanyDto, CreateContactDto } from './dto/customer-company.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { StaffGuard } from '../auth/staff.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/customer-companies')
export class CustomerCompaniesController {
  constructor(private service: CustomerCompaniesService) {}

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
