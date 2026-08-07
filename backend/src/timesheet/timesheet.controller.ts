import {
  Controller, Get, Post, Body, Query, UseGuards, Request,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { TimesheetService } from './timesheet.service';
import { SaveWeekDto } from './dto/timesheet.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; username?: string } };

// Internal agents & admins only (no Customer role on any route).
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin', 'Viewer')
@Controller('api/timesheet')
export class TimesheetController {
  constructor(private timesheet: TimesheetService) {}

  @Get('week')
  getWeek(
    @Request() req: AuthedRequest,
    @Query('weekStart') weekStart: string,
    @Query('userId') userId?: string,
  ) {
    return this.timesheet.getWeek(req.user.clientId, req.user, weekStart, userId);
  }

  @Post('week')
  saveWeek(@Body() dto: SaveWeekDto, @Request() req: AuthedRequest) {
    return this.timesheet.saveWeek(req.user.clientId, req.user, dto);
  }

  @Post('week/import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads/timesheet'),
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  importWeek(@UploadedFile() file: Express.Multer.File, @Request() req: AuthedRequest) {
    return this.timesheet.importWeek(req.user.clientId, file);
  }
}
