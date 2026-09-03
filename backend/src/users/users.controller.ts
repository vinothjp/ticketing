import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Res,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { sendWorkbook, stamp } from '../lib/spreadsheet';
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

  // ---- Employee Master import / export ----
  // An employee *is* a staff user, so these live here rather than on an
  // `employees` controller there is deliberately no such thing as. Declared
  // before `:id`, or the param route swallows them.

  /** Every employee as a spreadsheet, ready to be edited and posted back. */
  @Get('employees/export')
  @Roles('Admin')
  async exportEmployees(@Request() req: AuthedRequest, @Res() res: Response) {
    sendWorkbook(res, `employees-${stamp()}.xlsx`, await this.usersService.exportEmployees(req.user.clientId));
  }

  /** The blank import template — the same columns, with an Instructions sheet. */
  @Get('employees/import-template')
  @Roles('Admin')
  employeeTemplate(@Res() res: Response) {
    sendWorkbook(res, 'employee-import-template.xlsx', this.usersService.employeeImportTemplate());
  }

  /** Bulk add/update, matched on employee ID then username. */
  @Post('employees/import')
  @Roles('Admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importEmployees(@UploadedFile() file: Express.Multer.File, @Request() req: AuthedRequest) {
    return this.usersService.importEmployees(req.user.clientId, req.user.id, file);
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
