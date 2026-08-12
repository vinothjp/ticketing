import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { StaffGuard } from '../auth/staff.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // GET is open to any authenticated *staff* member — the ticket detail/create
  // screens need the user list to show/assign technicians. StaffGuard keeps
  // external customers out, so the internal staff roster isn't disclosed to them.
  @Get()
  @UseGuards(StaffGuard)
  findAll(@Request() req: AuthedRequest, @Query('includeCustomers') includeCustomers?: string) {
    return this.usersService.findAll(req.user.clientId, includeCustomers === 'true');
  }

  @Get(':id')
  @UseGuards(StaffGuard)
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
