import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request,
} from '@nestjs/common';
import { ProjectTemplatesService } from './project-templates.service';
import { CreateProjectTemplateDto, UpdateProjectTemplateDto } from './dto/project-template.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

// Staff-only (Admin + agents). Reads stay open to agents so the Create Project
// dialog can offer templates; writes (managing templates) are Admin-only.
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin', 'Viewer')
@Controller('api/project-templates')
export class ProjectTemplatesController {
  constructor(private service: ProjectTemplatesService) {}

  @Get()
  findAll(@Request() req: AuthedRequest) {
    return this.service.list(req.user.clientId);
  }

  @Get(':id')
  getById(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.getById(id, req.user.clientId);
  }

  @Post()
  @Roles('Admin')
  create(@Body() dto: CreateProjectTemplateDto, @Request() req: AuthedRequest) {
    return this.service.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id')
  @Roles('Admin')
  update(@Param('id') id: string, @Body() dto: UpdateProjectTemplateDto, @Request() req: AuthedRequest) {
    return this.service.update(id, req.user.clientId, dto, req.user.id);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.service.remove(id, req.user.clientId);
  }
}
