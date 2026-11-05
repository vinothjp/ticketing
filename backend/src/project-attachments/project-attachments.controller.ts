import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request,
  UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { ProjectAttachmentsService } from './project-attachments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; username?: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('api/projects')
export class ProjectAttachmentsController {
  constructor(private attachments: ProjectAttachmentsService) {}

  @Get(':projectId/attachments')
  list(
    @Param('projectId') projectId: string,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.attachments.list(projectId, entityType, entityId, req.user.clientId);
  }

  @Post(':projectId/attachments/upload')
  @Roles('Admin', 'Viewer')
  @UseInterceptors(
    FilesInterceptor('attachments', 5, {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads/projects'),
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB (kept in sync with frontend uploads.ts)
    }),
  )
  upload(
    @Param('projectId') projectId: string,
    @Body('entityType') entityType: string,
    @Body('entityId') entityId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: AuthedRequest,
  ) {
    return this.attachments.upload(projectId, entityType, entityId, files, req.user.clientId, req.user);
  }

  @Post(':projectId/attachments/link')
  @Roles('Admin', 'Viewer')
  addLink(
    @Param('projectId') projectId: string,
    @Body() body: { entityType: string; entityId: string; url: string; fileName?: string },
    @Request() req: AuthedRequest,
  ) {
    return this.attachments.addLink(projectId, body.entityType, body.entityId, body.url, body.fileName, req.user.clientId, req.user);
  }

  @Delete('attachments/:attId')
  @Roles('Admin', 'Viewer')
  remove(@Param('attId') attId: string, @Request() req: AuthedRequest) {
    return this.attachments.remove(attId, req.user.clientId);
  }
}
