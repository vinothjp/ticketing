import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { AssignTechniciansDto } from './dto/assign-technicians.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { FIELD_CATALOG } from './field-catalog';

type AuthedRequest = { user: { id: string; clientId: string } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/tickets')
export class TicketsController {
  constructor(private ticketsService: TicketsService) {}

  @Get()
  findAll(@Request() req: AuthedRequest) {
    return this.ticketsService.findAll(req.user.clientId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ticketsService.findOne(id, req.user.clientId);
  }

  @Post()
  create(@Body() dto: CreateTicketDto, @Request() req: AuthedRequest) {
    return this.ticketsService.create(dto, req.user.clientId, req.user.id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @Request() req: AuthedRequest,
  ) {
    return this.ticketsService.update(id, req.user.clientId, dto, req.user.id);
  }

  @Put(':id/technicians')
  assignTechnicians(
    @Param('id') id: string,
    @Body() dto: AssignTechniciansDto,
    @Request() req: AuthedRequest,
  ) {
    return this.ticketsService.assignTechnicians(
      id,
      req.user.clientId,
      dto.userIds,
      req.user.id,
    );
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FilesInterceptor('attachments', 10, {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads/tickets'),
        filename: (req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadAttachments(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: AuthedRequest,
  ) {
    return this.ticketsService.addAttachments(
      id,
      req.user.clientId,
      files,
      req.user.id,
    );
  }
}

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/field-catalog')
export class FieldCatalogController {
  @Get()
  findAll() {
    return FIELD_CATALOG;
  }
}
