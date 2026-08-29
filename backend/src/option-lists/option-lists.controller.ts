import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { OptionListsService } from './option-lists.service';
import {
  CreateOptionListDto,
  UpdateOptionListDto,
  CreateOptionValueDto,
  UpdateOptionValueDto,
} from './dto/option-list.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

// The single admin API behind the unified Option List screen. Every dropdown
// elsewhere still reads its own endpoint (`api/picklist-options`,
// `api/change-requests/options`) — this one only manages them.
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin')
@Controller('api/option-lists')
export class OptionListsController {
  constructor(private optionLists: OptionListsService) {}

  @Get()
  findAll(@Request() req: AuthedRequest) {
    return this.optionLists.findAll(req.user.clientId);
  }

  @Post()
  create(@Body() dto: CreateOptionListDto, @Request() req: AuthedRequest) {
    return this.optionLists.create(dto, req.user.clientId, req.user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOptionListDto,
    @Request() req: AuthedRequest,
  ) {
    return this.optionLists.update(id, dto, req.user.clientId, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.optionLists.remove(id, req.user.clientId);
  }

  // ---- values of one list ----

  @Get(':id/values')
  listValues(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.optionLists.listValues(id, req.user.clientId);
  }

  @Get(':id/parent-values')
  listParentValues(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.optionLists.listParentValues(id, req.user.clientId);
  }

  @Post(':id/values')
  addValue(
    @Param('id') id: string,
    @Body() dto: CreateOptionValueDto,
    @Request() req: AuthedRequest,
  ) {
    return this.optionLists.addValue(id, dto, req.user.clientId, req.user);
  }

  @Patch(':id/values/:valueId')
  updateValue(
    @Param('id') id: string,
    @Param('valueId') valueId: string,
    @Body() dto: UpdateOptionValueDto,
    @Request() req: AuthedRequest,
  ) {
    return this.optionLists.updateValue(
      id,
      valueId,
      dto,
      req.user.clientId,
      req.user,
    );
  }

  @Delete(':id/values/:valueId')
  removeValue(
    @Param('id') id: string,
    @Param('valueId') valueId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.optionLists.removeValue(id, valueId, req.user.clientId);
  }
}
