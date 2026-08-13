import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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
import { SetResolutionDto } from './dto/set-resolution.dto';
import { RejectTicketDto } from './dto/reject-ticket.dto';
import { CreateWorklogDto } from './dto/worklog.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { StaffGuard } from '../auth/staff.guard';
import { CustomerAdminGuard } from '../auth/customer-admin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FIELD_CATALOG } from './field-catalog';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; customerCompanyId?: string | null } };

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/tickets')
export class TicketsController {
  constructor(private ticketsService: TicketsService) {}

  @Get()
  findAll(@Request() req: AuthedRequest) {
    return this.ticketsService.findAll(req.user.clientId, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ticketsService.findOne(id, req.user.clientId, req.user);
  }

  @Get(':id/activity')
  getActivity(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ticketsService.getActivity(id, req.user.clientId, req.user);
  }

  // ---- Worklog / support-hours time tracking (staff only) ----
  @Get(':id/worklogs')
  @UseGuards(StaffGuard)
  listWorklogs(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ticketsService.listWorklogs(id, req.user.clientId, req.user);
  }

  @Post(':id/worklogs')
  @UseGuards(StaffGuard)
  addWorklog(@Param('id') id: string, @Body() dto: CreateWorklogDto, @Request() req: AuthedRequest) {
    return this.ticketsService.addWorklog(id, dto, req.user.clientId, req.user.id, req.user);
  }

  @Delete(':id/worklogs/:worklogId')
  @UseGuards(StaffGuard)
  deleteWorklog(@Param('id') id: string, @Param('worklogId') worklogId: string, @Request() req: AuthedRequest) {
    return this.ticketsService.deleteWorklog(id, worklogId, req.user.clientId, req.user);
  }

  @Put(':id/resolution')
  @UseGuards(StaffGuard)
  setResolution(
    @Param('id') id: string,
    @Body() dto: SetResolutionDto,
    @Request() req: AuthedRequest,
  ) {
    return this.ticketsService.setResolution(id, req.user.clientId, dto, req.user.id, req.user);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ticketsService.reopen(id, req.user.clientId, req.user.id, req.user);
  }

  // Creation-approval gate — tenant Admin only.
  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  approve(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ticketsService.approve(id, req.user.clientId, req.user.id, req.user);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  reject(@Param('id') id: string, @Body() dto: RejectTicketDto, @Request() req: AuthedRequest) {
    return this.ticketsService.reject(id, req.user.clientId, dto, req.user.id, req.user);
  }

  // Stage 1 — a customer company admin approves/rejects their employee's ticket.
  @Post(':id/customer-approve')
  @UseGuards(CustomerAdminGuard)
  customerApprove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ticketsService.customerApprove(id, req.user.clientId, req.user.id, req.user);
  }

  @Post(':id/customer-reject')
  @UseGuards(CustomerAdminGuard)
  customerReject(@Param('id') id: string, @Body() dto: RejectTicketDto, @Request() req: AuthedRequest) {
    return this.ticketsService.customerReject(id, req.user.clientId, dto, req.user.id, req.user);
  }

  @Post()
  create(@Body() dto: CreateTicketDto, @Request() req: AuthedRequest) {
    return this.ticketsService.create(dto, req.user.clientId, req.user.id, req.user);
  }

  @Put(':id')
  @UseGuards(StaffGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @Request() req: AuthedRequest,
  ) {
    return this.ticketsService.update(id, req.user.clientId, dto, req.user.id, req.user);
  }

  @Put(':id/technicians')
  @UseGuards(StaffGuard)
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
      req.user,
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
      limits: { fileSize: 5 * 1024 * 1024 },
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
      req.user,
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
