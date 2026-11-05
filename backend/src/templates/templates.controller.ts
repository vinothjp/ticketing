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
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateFieldsDto } from './dto/update-template-fields.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/templates')
export class TemplatesController {
  constructor(private templatesService: TemplatesService) {}

  // Reads stay open — the New Ticket form needs the template list + fields.
  @Get()
  findAll(@Request() req: AuthedRequest) {
    return this.templatesService.findAll(req.user.clientId);
  }

  @Get(':id')
  getById(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.templatesService.getById(id, req.user.clientId);
  }

  @Post()
  @Roles('Admin')
  create(@Body() dto: CreateTemplateDto, @Request() req: AuthedRequest) {
    return this.templatesService.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id/fields')
  @Roles('Admin')
  updateFields(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateFieldsDto,
    @Request() req: AuthedRequest,
  ) {
    return this.templatesService.updateFields(
      id,
      req.user.clientId,
      dto,
      req.user.id,
    );
  }

  @Put(':id')
  @Roles('Admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @Request() req: AuthedRequest,
  ) {
    return this.templatesService.update(id, req.user.clientId, dto, req.user.id);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.templatesService.remove(id, req.user.clientId);
  }
}
