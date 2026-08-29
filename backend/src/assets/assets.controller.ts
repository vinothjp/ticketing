import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto, UpdateAssetDto } from './dto/asset.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

// Asset Master is a tenant-admin screen, so the whole controller is Admin-only.
// The one exception is the read of available assets, which the asset-request
// dialog on a ticket needs — see `available` below.
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin')
@Controller('api/assets')
export class AssetsController {
  constructor(private assets: AssetsService) {}

  @Get()
  @Roles('Admin', 'Viewer') // an agent raising an asset request must see what is free
  list(@Request() req: AuthedRequest, @Query('q') q?: string, @Query('available') available?: string) {
    return this.assets.list(req.user.clientId, { q, available: available === 'true' });
  }

  @Get(':id')
  findOne(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.assets.findOne(id, req.user.clientId);
  }

  @Get(':id/allocations')
  allocations(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.assets.listAllocations(id, req.user.clientId);
  }

  @Post()
  create(@Request() req: AuthedRequest, @Body() dto: CreateAssetDto) {
    return this.assets.create(req.user.clientId, dto, req.user.id);
  }

  @Patch(':id')
  update(@Request() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(id, req.user.clientId, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.assets.remove(id, req.user.clientId);
  }
}
