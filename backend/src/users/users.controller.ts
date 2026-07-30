import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // GET stays open to any authenticated tenant user — the ticket detail/create
  // screens need the user list to show/assign technicians.
  @Get()
  findAll(@Request() req: AuthedRequest) { return this.usersService.findAll(req.user.clientId); }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.usersService.findOne(id, req.user.clientId);
  }

  @Post()
  @Roles('Admin')
  create(@Body() dto: CreateUserDto, @Request() req: AuthedRequest) {
    return this.usersService.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id')
  @Roles('Admin')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req: AuthedRequest) {
    return this.usersService.update(id, dto, req.user.clientId, req.user.id);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.usersService.remove(id, req.user.clientId);
  }

  @Post(':id/roles')
  @Roles('Admin')
  assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto, @Request() req: AuthedRequest) {
    return this.usersService.assignRoles(id, dto.roleIds, req.user.clientId, req.user.id);
  }
}
