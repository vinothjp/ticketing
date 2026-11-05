import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ResourcesService } from './resources.service';
import { CreateResourceCategoryDto, UpdateResourceCategoryDto } from './dto/resource-category.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/resource-categories')
export class ResourcesController {
  constructor(private resources: ResourcesService) {}

  // Read: any staff (needed to pick a category in a project's resource plan).
  @Get()
  @Roles('Admin', 'Viewer')
  list(@Request() req: AuthedRequest) {
    return this.resources.list(req.user.clientId);
  }

  @Post()
  @Roles('Admin')
  create(@Body() dto: CreateResourceCategoryDto, @Request() req: AuthedRequest) {
    return this.resources.create(dto, req.user.clientId, req.user);
  }

  @Patch(':id')
  @Roles('Admin')
  update(@Param('id') id: string, @Body() dto: UpdateResourceCategoryDto, @Request() req: AuthedRequest) {
    return this.resources.update(id, dto, req.user.clientId, req.user);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.resources.remove(id, req.user.clientId);
  }
}
