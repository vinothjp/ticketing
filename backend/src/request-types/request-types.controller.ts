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
import { RequestTypesService } from './request-types.service';
import { CreateRequestTypeDto } from './dto/create-request-type.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/request-types')
export class RequestTypesController {
  constructor(private requestTypesService: RequestTypesService) {}

  @Get()
  findAll(@Request() req: AuthedRequest) {
    return this.requestTypesService.findAll(req.user.clientId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.requestTypesService.findOne(id, req.user.clientId);
  }

  @Post()
  create(@Body() dto: CreateRequestTypeDto, @Request() req: AuthedRequest) {
    return this.requestTypesService.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: CreateRequestTypeDto,
    @Request() req: AuthedRequest,
  ) {
    return this.requestTypesService.update(
      id,
      dto,
      req.user.clientId,
      req.user.id,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.requestTypesService.remove(id, req.user.clientId);
  }
}
