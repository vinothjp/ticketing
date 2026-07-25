import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { PicklistsService } from './picklists.service';
import { CreatePicklistOptionDto } from './dto/create-picklist-option.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/picklist-options')
export class PicklistsController {
  constructor(private picklistsService: PicklistsService) {}

  @Get()
  findAll(
    @Query('listKey') listKey: string | undefined,
    @Request() req: AuthedRequest,
  ) {
    return this.picklistsService.findAll(req.user.clientId, listKey);
  }

  @Post()
  create(@Body() dto: CreatePicklistOptionDto, @Request() req: AuthedRequest) {
    return this.picklistsService.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: CreatePicklistOptionDto,
    @Request() req: AuthedRequest,
  ) {
    return this.picklistsService.update(
      id,
      dto,
      req.user.clientId,
      req.user.id,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.picklistsService.remove(id, req.user.clientId);
  }
}
