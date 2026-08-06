import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { RegistersService } from './registers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

// Project governance registers: risks | issues | change-requests | approvals | meetings | deadlines | documents
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin', 'Viewer')
@Controller('api/projects')
export class RegistersController {
  constructor(private registers: RegistersService) {}

  @Get(':id/registers/:type')
  list(@Param('id') id: string, @Param('type') type: string, @Request() req: AuthedRequest) {
    return this.registers.list(id, type, req.user.clientId);
  }

  @Post(':id/registers/:type')
  create(@Param('id') id: string, @Param('type') type: string, @Body() body: Record<string, unknown>, @Request() req: AuthedRequest) {
    return this.registers.create(id, type, body, req.user.clientId, req.user);
  }

  @Patch('registers/:type/:itemId')
  update(@Param('type') type: string, @Param('itemId') itemId: string, @Body() body: Record<string, unknown>, @Request() req: AuthedRequest) {
    return this.registers.update(type, itemId, body, req.user.clientId);
  }

  @Delete('registers/:type/:itemId')
  remove(@Param('type') type: string, @Param('itemId') itemId: string, @Request() req: AuthedRequest) {
    return this.registers.remove(type, itemId, req.user.clientId);
  }
}
