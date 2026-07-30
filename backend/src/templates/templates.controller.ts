import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { UpdateTemplateFieldsDto } from './dto/update-template-fields.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/templates')
export class TemplatesController {
  constructor(private templatesService: TemplatesService) {}

  @Get('by-request-type/:requestTypeId')
  getByRequestType(
    @Param('requestTypeId') requestTypeId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.templatesService.getByRequestType(
      requestTypeId,
      req.user.clientId,
    );
  }

  @Put(':id/fields')
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
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @Request() req: AuthedRequest,
  ) {
    return this.templatesService.update(
      id,
      req.user.clientId,
      dto,
      req.user.id,
    );
  }
}
