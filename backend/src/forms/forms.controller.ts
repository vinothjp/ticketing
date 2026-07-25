import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { FormsService } from './forms.service';
import { CreateFormDto } from './dto/create-form.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string } };

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SuperAdmin')
@Controller('api/forms')
export class FormsController {
  constructor(private formsService: FormsService) {}

  @Get()
  findAll() { return this.formsService.findAll(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.formsService.findOne(id); }

  @Post()
  create(@Body() dto: CreateFormDto, @Request() req: AuthedRequest) {
    return this.formsService.create(dto, req.user.id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CreateFormDto, @Request() req: AuthedRequest) {
    return this.formsService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.formsService.remove(id); }
}
