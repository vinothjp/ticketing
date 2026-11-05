import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request,
} from '@nestjs/common';
import { CustomerTeamService } from './customer-team.service';
import { CreateTeamMemberDto, UpdateTeamMemberDto } from './dto/customer-team.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { CustomerAdminGuard } from '../auth/customer-admin.guard';

type AuthedRequest = {
  user: { id: string; clientId: string; customerCompanyId: string };
};

// Self-service team management for a customer company's own admin.
@UseGuards(JwtAuthGuard, TenantGuard, CustomerAdminGuard)
@Controller('api/my-team')
export class CustomerTeamController {
  constructor(private team: CustomerTeamService) {}

  @Get()
  list(@Request() req: AuthedRequest) {
    return this.team.list(req.user);
  }

  @Post()
  create(@Body() dto: CreateTeamMemberDto, @Request() req: AuthedRequest) {
    return this.team.create(dto, req.user);
  }

  @Patch(':userId')
  update(@Param('userId') userId: string, @Body() dto: UpdateTeamMemberDto, @Request() req: AuthedRequest) {
    return this.team.update(userId, dto, req.user);
  }

  @Delete(':userId')
  remove(@Param('userId') userId: string, @Request() req: AuthedRequest) {
    return this.team.remove(userId, req.user);
  }
}
