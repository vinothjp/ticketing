import {
  Controller, Get, Put, Post, Delete, Body, Request, UseGuards,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { ClientsService } from '../clients/clients.service';
import { UpdateMyClientDto } from '../clients/dto/update-my-client.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin')
@Controller('api/my-client')
export class MyClientController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  getMyClient(@Request() req: AuthedRequest) {
    return this.clientsService.findOne(req.user.clientId);
  }

  @Put()
  updateMyClient(@Request() req: AuthedRequest, @Body() dto: UpdateMyClientDto) {
    return this.clientsService.update(req.user.clientId, dto, req.user.id);
  }

  @Post('logo')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads/logos'),
        filename: (req: any, file, cb) => {
          cb(null, `${req.user.clientId}-${Date.now()}${extname(file.originalname)}`);
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
  uploadLogo(@Request() req: AuthedRequest, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.clientsService.setLogo(req.user.clientId, `/uploads/logos/${file.filename}`, req.user.id);
  }

  @Delete('logo')
  removeLogo(@Request() req: AuthedRequest) {
    return this.clientsService.removeLogo(req.user.clientId, req.user.id);
  }
}
