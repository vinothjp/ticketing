import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, Res,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AssetsService } from './assets.service';
import { CreateAssetDto, UpdateAssetDto } from './dto/asset.dto';
import { sendWorkbook, stamp } from '../lib/spreadsheet';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

// Asset Master is a tenant-admin screen, so the whole controller is Admin-only.
// The one exception is the read of available assets, which the asset-request
// dialog on a ticket needs — see `available` below.
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin')
@Controller('api/assets')
export class AssetsController {
  constructor(private assets: AssetsService) {}

  @Get()
  @Roles('Admin', 'Viewer') // an agent raising an asset request must see what is free
  list(@Request() req: AuthedRequest, @Query('q') q?: string, @Query('available') available?: string) {
    return this.assets.list(req.user.clientId, { q, available: available === 'true' });
  }

  // Declared before `:id`, or the param route swallows them.

  /** The register as a spreadsheet, ready to be edited and posted back. */
  @Get('export')
  async exportAssets(@Request() req: AuthedRequest, @Res() res: Response) {
    sendWorkbook(res, `assets-${stamp()}.xlsx`, await this.assets.exportSheet(req.user.clientId));
  }

  /** The blank import template — the same columns, with an Instructions sheet. */
  @Get('import-template')
  importTemplate(@Res() res: Response) {
    sendWorkbook(res, 'asset-import-template.xlsx', this.assets.importTemplate());
  }

  /** Bulk add/update, matched on asset ID. Answers with a per-row account. */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importAssets(@UploadedFile() file: Express.Multer.File, @Request() req: AuthedRequest) {
    return this.assets.importSheet(req.user.clientId, req.user.id, file);
  }

  @Get(':id')
  findOne(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.assets.findOne(id, req.user.clientId);
  }

  // No `:id/allocations` route: an asset's allocations are read through
  // `GET api/asset-allocations?assetId=`, the same door the employee screen uses,
  // so one grid component serves both masters and neither can drift.

  @Post()
  create(@Request() req: AuthedRequest, @Body() dto: CreateAssetDto) {
    return this.assets.create(req.user.clientId, dto, req.user.id);
  }

  @Patch(':id')
  update(@Request() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(id, req.user.clientId, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.assets.remove(id, req.user.clientId);
  }
}
