import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { ClientVisitsService } from './client-visits.service';
import { CreateClientVisitDto, UpdateClientVisitDto } from './dto/client-visit.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; username?: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin')
@Controller('api/client-visits')
export class ClientVisitsController {
  constructor(private readonly clientVisitsService: ClientVisitsService) {}

  @Post()
  create(@Request() req: AuthedRequest, @Body() createDto: CreateClientVisitDto) {
    return this.clientVisitsService.create(req.user.clientId, createDto, req.user.id);
  }

  @Get()
  findAll(
    @Request() req: AuthedRequest,
    @Query('customerCompanyId') customerCompanyId?: string,
    @Query('consultantId') consultantId?: string,
    @Query('productId') productId?: string,
    @Query('ticketId') ticketId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.clientVisitsService.findAll(req.user.clientId, {
      customerCompanyId,
      consultantId,
      productId,
      ticketId,
      status,
      from,
      to,
    });
  }

  @Get(':id')
  findOne(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.clientVisitsService.findOne(req.user.clientId, id);
  }

  @Patch(':id')
  update(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() updateDto: UpdateClientVisitDto,
  ) {
    return this.clientVisitsService.update(req.user.clientId, id, updateDto, req.user.id);
  }

  @Delete(':id')
  remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.clientVisitsService.remove(req.user.clientId, id);
  }
}
