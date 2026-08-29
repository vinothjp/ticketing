import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AssetAllocationsService } from './asset-allocations.service';
import { CreateAssetAllocationDto, UpdateAssetAllocationDto } from './dto/asset-allocation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin')
@Controller('api/asset-allocations')
export class AssetAllocationsController {
  constructor(private allocations: AssetAllocationsService) {}

  @Get()
  list(
    @Request() req: AuthedRequest,
    @Query('employeeUserId') employeeUserId?: string,
    @Query('assetId') assetId?: string,
    @Query('status') status?: string,
  ) {
    return this.allocations.list(req.user.clientId, { employeeUserId, assetId, status });
  }

  @Post()
  create(@Request() req: AuthedRequest, @Body() dto: CreateAssetAllocationDto) {
    return this.allocations.create(req.user.clientId, dto, req.user.id);
  }

  @Patch(':id')
  update(@Request() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateAssetAllocationDto) {
    return this.allocations.update(id, req.user.clientId, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.allocations.remove(id, req.user.clientId);
  }
}
