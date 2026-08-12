import {
  Controller, Get, Post, Patch, Put, Delete, Body, Param, UseGuards, Request,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import {
  CreateProductDto, UpdateProductDto, CreateModuleDto, UpdateModuleDto, SetConsultantDto,
} from './dto/product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

// Reads open to staff (ticket forms/dropdowns need them); config is Admin-only.
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin', 'Viewer')
@Controller('api/products')
export class ProductsController {
  constructor(private service: ProductsService) {}

  @Get()
  list(@Request() req: AuthedRequest) {
    return this.service.list(req.user.clientId);
  }

  @Post()
  @Roles('Admin')
  createProduct(@Body() dto: CreateProductDto, @Request() req: AuthedRequest) {
    return this.service.createProduct(dto, req.user.clientId);
  }

  @Patch(':id')
  @Roles('Admin')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto, @Request() req: AuthedRequest) {
    return this.service.updateProduct(id, dto, req.user.clientId);
  }

  @Delete(':id')
  @Roles('Admin')
  removeProduct(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.removeProduct(id, req.user.clientId);
  }

  @Post(':id/modules')
  @Roles('Admin')
  addModule(@Param('id') id: string, @Body() dto: CreateModuleDto, @Request() req: AuthedRequest) {
    return this.service.addModule(id, dto, req.user.clientId);
  }

  @Patch('modules/:moduleId')
  @Roles('Admin')
  updateModule(@Param('moduleId') moduleId: string, @Body() dto: UpdateModuleDto, @Request() req: AuthedRequest) {
    return this.service.updateModule(moduleId, dto, req.user.clientId);
  }

  @Delete('modules/:moduleId')
  @Roles('Admin')
  removeModule(@Param('moduleId') moduleId: string, @Request() req: AuthedRequest) {
    return this.service.removeModule(moduleId, req.user.clientId);
  }

  @Put('modules/:moduleId/consultant')
  @Roles('Admin')
  setConsultant(@Param('moduleId') moduleId: string, @Body() dto: SetConsultantDto, @Request() req: AuthedRequest) {
    return this.service.setConsultant(moduleId, dto, req.user.clientId);
  }
}
