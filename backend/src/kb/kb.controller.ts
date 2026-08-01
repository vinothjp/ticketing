import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request,
  UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { KbService } from './kb.service';
import { CreateKbArticleDto, UpdateKbArticleDto } from './dto/kb-article.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; username?: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/kb-articles')
export class KbController {
  constructor(private kb: KbService) {}

  // Distinct keywords for autocomplete — declared before :id so it isn't captured as an id.
  @Get('keywords')
  @Roles('Admin', 'Viewer')
  keywords(@Request() req: AuthedRequest) {
    return this.kb.keywords(req.user.clientId);
  }

  // Reads are open to any tenant user; the service scopes customers to published+customer articles.
  @Get()
  list(
    @Request() req: AuthedRequest,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.kb.list(req.user.clientId, req.user, { search, category });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.kb.findOne(id, req.user.clientId, req.user);
  }

  @Post()
  @Roles('Admin', 'Viewer')
  create(@Body() dto: CreateKbArticleDto, @Request() req: AuthedRequest) {
    return this.kb.create(dto, req.user.clientId, req.user);
  }

  @Patch(':id')
  @Roles('Admin', 'Viewer')
  update(@Param('id') id: string, @Body() dto: UpdateKbArticleDto, @Request() req: AuthedRequest) {
    return this.kb.update(id, dto, req.user.clientId, req.user.id);
  }

  @Delete(':id')
  @Roles('Admin', 'Viewer')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.kb.remove(id, req.user.clientId);
  }

  @Post(':id/attachments')
  @Roles('Admin', 'Viewer')
  @UseInterceptors(
    FilesInterceptor('attachments', 5, {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads/kb'),
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadAttachments(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: AuthedRequest,
  ) {
    return this.kb.addAttachments(id, req.user.clientId, files, req.user.id);
  }

  @Delete(':id/attachments/:attId')
  @Roles('Admin', 'Viewer')
  removeAttachment(@Param('id') id: string, @Param('attId') attId: string, @Request() req: AuthedRequest) {
    return this.kb.removeAttachment(id, attId, req.user.clientId);
  }
}
