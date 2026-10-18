import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request,
  UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { GalleryService, MAX_PHOTOS_PER_UPLOAD, MAX_UPLOAD_BYTES } from './gallery.service';
import { CreateAlbumDto, UpdateAlbumDto, UpdatePhotoDto } from './dto/gallery.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { StaffGuard } from '../auth/staff.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; username?: string } };

/**
 * Photo gallery. Every staff member views albums; only an Admin creates, edits,
 * uploads and deletes. Client-side logins never reach it.
 */
@UseGuards(JwtAuthGuard, TenantGuard, StaffGuard, RolesGuard)
@Controller('api/gallery')
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get('albums')
  list(@Request() req: AuthedRequest, @Query('category') category?: string) {
    return this.gallery.list(req.user.clientId, category || undefined);
  }

  @Get('albums/:id')
  get(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.gallery.get(id, req.user.clientId);
  }

  @Post('albums')
  @Roles('Admin')
  create(@Body() dto: CreateAlbumDto, @Request() req: AuthedRequest) {
    return this.gallery.create(dto, req.user.clientId, req.user);
  }

  @Patch('albums/:id')
  @Roles('Admin')
  update(@Param('id') id: string, @Body() dto: UpdateAlbumDto, @Request() req: AuthedRequest) {
    return this.gallery.update(id, dto, req.user.clientId);
  }

  @Delete('albums/:id')
  @Roles('Admin')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.gallery.remove(id, req.user.clientId);
  }

  /**
   * Multipart `photos`, up to 10. Held in memory (not written straight to disk)
   * because each one is shrunk before anything is stored; the type check is per
   * file in the service, so one wrong file doesn't sink the other nine.
   */
  @Post('albums/:id/photos')
  @Roles('Admin')
  @UseInterceptors(FilesInterceptor('photos', MAX_PHOTOS_PER_UPLOAD, {
    storage: memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_PHOTOS_PER_UPLOAD },
  }))
  addPhotos(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[], @Request() req: AuthedRequest) {
    return this.gallery.addPhotos(id, files, req.user.clientId, req.user);
  }

  @Patch('photos/:photoId')
  @Roles('Admin')
  updatePhoto(@Param('photoId') photoId: string, @Body() dto: UpdatePhotoDto, @Request() req: AuthedRequest) {
    return this.gallery.updatePhoto(photoId, dto, req.user.clientId);
  }

  @Delete('photos/:photoId')
  @Roles('Admin')
  removePhoto(@Param('photoId') photoId: string, @Request() req: AuthedRequest) {
    return this.gallery.removePhoto(photoId, req.user.clientId);
  }
}
