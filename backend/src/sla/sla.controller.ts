import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SlaService } from './sla.service';
import { CreateSlaPolicyDto } from './dto/create-sla-policy.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/sla-policies')
export class SlaController {
  constructor(private slaService: SlaService) {}

  // GET stays open — the New Ticket form shows the SLA target for the chosen priority.
  @Get()
  findAll(@Request() req: AuthedRequest) {
    return this.slaService.findAll(req.user.clientId);
  }

  @Post()
  @Roles('Admin')
  create(@Body() dto: CreateSlaPolicyDto, @Request() req: AuthedRequest) {
    return this.slaService.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id')
  @Roles('Admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSlaPolicyDto,
    @Request() req: AuthedRequest,
  ) {
    return this.slaService.update(id, req.user.clientId, dto, req.user.id);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.slaService.remove(id, req.user.clientId);
  }
}
