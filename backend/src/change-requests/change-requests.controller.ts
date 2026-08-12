import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request,
  UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { ChangeRequestsService } from './change-requests.service';
import { CrOptionsService } from './cr-options.service';
import { CrAttachmentsService } from './cr-attachments.service';
import {
  CreateChangeRequestDto, UpdateChangeRequestDto,
  CreateCrOptionDto, UpdateCrOptionDto, CrAttachmentLinkDto,
} from './dto/change-request.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; username?: string } };

// Internal agents & admins only (no Customer role on any route).
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin', 'Viewer')
@Controller('api/change-requests')
export class ChangeRequestsController {
  constructor(
    private crs: ChangeRequestsService,
    private options: CrOptionsService,
    private attachments: CrAttachmentsService,
  ) {}

  // ---- CR option store (declared before ':id' so "options" isn't a CR id) ----
  @Get('options')
  listOptions(@Request() req: AuthedRequest, @Query('listKey') listKey?: string) {
    return this.options.findAll(req.user.clientId, listKey);
  }

  @Post('options')
  @Roles('Admin')
  createOption(@Body() dto: CreateCrOptionDto, @Request() req: AuthedRequest) {
    return this.options.create(dto, req.user.clientId, req.user);
  }

  @Patch('options/:optId')
  @Roles('Admin')
  updateOption(@Param('optId') optId: string, @Body() dto: UpdateCrOptionDto, @Request() req: AuthedRequest) {
    return this.options.update(optId, dto, req.user.clientId, req.user);
  }

  @Delete('options/:optId')
  @Roles('Admin')
  removeOption(@Param('optId') optId: string, @Request() req: AuthedRequest) {
    return this.options.remove(optId, req.user.clientId);
  }

  // ---- Attachments (blueprint / supportive / uat slots) ----
  @Get(':id/attachments')
  listAttachments(@Param('id') id: string, @Query('entityType') entityType: string, @Request() req: AuthedRequest) {
    return this.attachments.list(id, entityType, req.user.clientId);
  }

  @Post(':id/attachments/upload')
  @UseInterceptors(
    FilesInterceptor('attachments', 5, {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads/change-requests'),
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB (kept in sync with frontend uploads.ts)
    }),
  )
  uploadAttachment(
    @Param('id') id: string,
    @Body('entityType') entityType: string,
    @Body('title') title: string | undefined,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: AuthedRequest,
  ) {
    return this.attachments.upload(id, entityType, title, files, req.user.clientId, req.user);
  }

  @Post(':id/attachments/link')
  addAttachmentLink(@Param('id') id: string, @Body() dto: CrAttachmentLinkDto, @Request() req: AuthedRequest) {
    return this.attachments.addLink(id, dto.entityType, dto.url, dto.fileName, dto.title, req.user.clientId, req.user);
  }

  @Delete('attachments/:attId')
  removeAttachment(@Param('attId') attId: string, @Request() req: AuthedRequest) {
    return this.attachments.remove(attId, req.user.clientId);
  }

  // ---- Change requests ----
  @Get()
  list(
    @Request() req: AuthedRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
  ) {
    return this.crs.list(req.user.clientId, { search, status, priority });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.crs.findOne(id, req.user.clientId);
  }

  @Post()
  create(@Body() dto: CreateChangeRequestDto, @Request() req: AuthedRequest) {
    return this.crs.create(dto, req.user.clientId, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChangeRequestDto, @Request() req: AuthedRequest) {
    return this.crs.update(id, dto, req.user.clientId, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.crs.remove(id, req.user.clientId);
  }

  // Provider sends the CR to its linked company's admin for approval.
  @Post(':id/send-approval')
  sendForApproval(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.crs.sendForApproval(id, req.user.clientId, req.user);
  }
}
