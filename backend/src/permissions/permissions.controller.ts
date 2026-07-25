import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { UpsertPermissionDto } from './dto/upsert-permission.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/permissions')
export class PermissionsController {
  constructor(private permissionsService: PermissionsService) {}

  @Get('matrix')
  getMatrix(@Request() req: AuthedRequest) { return this.permissionsService.getMatrix(req.user.clientId); }

  @Get('role/:roleId')
  getByRole(@Param('roleId') roleId: string, @Request() req: AuthedRequest) {
    return this.permissionsService.getByRole(roleId, req.user.clientId);
  }

  @Post()
  upsert(@Body() dto: UpsertPermissionDto, @Request() req: AuthedRequest) {
    return this.permissionsService.upsert(dto, req.user.clientId, req.user.id);
  }

  @Delete(':roleId/:formId')
  remove(@Param('roleId') roleId: string, @Param('formId') formId: string, @Request() req: AuthedRequest) {
    return this.permissionsService.remove(roleId, formId, req.user.clientId);
  }
}
