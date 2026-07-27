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

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/sla-policies')
export class SlaController {
  constructor(private slaService: SlaService) {}

  @Get()
  findAll(@Request() req: AuthedRequest) {
    return this.slaService.findAll(req.user.clientId);
  }

  @Post()
  create(@Body() dto: CreateSlaPolicyDto, @Request() req: AuthedRequest) {
    return this.slaService.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSlaPolicyDto,
    @Request() req: AuthedRequest,
  ) {
    return this.slaService.update(id, req.user.clientId, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.slaService.remove(id, req.user.clientId);
  }
}
