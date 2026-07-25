import {
  Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { UpsertLicenseDto } from './dto/upsert-license.dto';
import { CreateClientUserDto } from './dto/create-client-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string } };

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SuperAdmin')
@Controller('api/super-admin/clients')
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  findAll() { return this.clientsService.findAll(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.clientsService.findOne(id); }

  @Post()
  create(@Body() dto: CreateClientDto, @Request() req: AuthedRequest) {
    return this.clientsService.create(dto, req.user.id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto, @Request() req: AuthedRequest) {
    return this.clientsService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.clientsService.remove(id); }

  @Put(':id/license')
  upsertLicense(@Param('id') id: string, @Body() dto: UpsertLicenseDto, @Request() req: AuthedRequest) {
    return this.clientsService.upsertLicense(id, dto, req.user.id);
  }

  @Post(':id/users')
  createUser(@Param('id') id: string, @Body() dto: CreateClientUserDto, @Request() req: AuthedRequest) {
    return this.clientsService.createUser(id, dto, req.user.id);
  }

  @Post(':id/logo')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads/logos'),
        filename: (req, file, cb) => {
          cb(null, `${req.params.id}-${Date.now()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadLogo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req: AuthedRequest) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.clientsService.setLogo(id, `/uploads/logos/${file.filename}`, req.user.id);
  }

  @Delete(':id/logo')
  removeLogo(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.clientsService.removeLogo(id, req.user.id);
  }
}
