import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/roles')
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  findAll(@Request() req: AuthedRequest) { return this.rolesService.findAll(req.user.clientId); }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.rolesService.findOne(id, req.user.clientId);
  }

  @Post()
  create(@Body() dto: CreateRoleDto, @Request() req: AuthedRequest) {
    return this.rolesService.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CreateRoleDto, @Request() req: AuthedRequest) {
    return this.rolesService.update(id, dto, req.user.clientId, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.rolesService.remove(id, req.user.clientId);
  }
}
