import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll(@Request() req: AuthedRequest) { return this.usersService.findAll(req.user.clientId); }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.usersService.findOne(id, req.user.clientId);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @Request() req: AuthedRequest) {
    return this.usersService.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req: AuthedRequest) {
    return this.usersService.update(id, dto, req.user.clientId, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.usersService.remove(id, req.user.clientId);
  }

  @Post(':id/roles')
  assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto, @Request() req: AuthedRequest) {
    return this.usersService.assignRoles(id, dto.roleIds, req.user.clientId, req.user.id);
  }
}
