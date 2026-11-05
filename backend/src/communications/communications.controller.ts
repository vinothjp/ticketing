import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { AnnouncementSuggestionsService } from './announcement-suggestions.service';
import {
  CreateCommunicationDto, UpdateCommunicationDto, ScheduleCommunicationDto,
  LinkSuggestionAlbumDto, MarkSuggestionUsedDto,
} from './dto/communication.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { StaffGuard } from '../auth/staff.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[]; username?: string } };
const isAdmin = (req: AuthedRequest) => req.user.roles.includes('Admin');

/**
 * Communication emails & newsletter. Every staff member reads what has been sent;
 * only an Admin writes, schedules and sends (and sees drafts and delivery logs —
 * the service narrows reads for everyone else). Client-side logins never reach it.
 */
@UseGuards(JwtAuthGuard, TenantGuard, StaffGuard, RolesGuard)
@Controller('api/communications')
export class CommunicationsController {
  constructor(
    private readonly communications: CommunicationsService,
    private readonly suggestions: AnnouncementSuggestionsService,
  ) {}

  // ---- Suggested announcements (Admin). Declared before `:id`. ----

  @Get('suggestions')
  @Roles('Admin')
  listSuggestions(@Request() req: AuthedRequest) {
    return this.suggestions.listPending(req.user.clientId);
  }

  @Get('suggestions/:sid')
  @Roles('Admin')
  getSuggestion(@Param('sid') sid: string, @Request() req: AuthedRequest) {
    return this.suggestions.get(sid, req.user.clientId);
  }

  @Post('suggestions/:sid/dismiss')
  @Roles('Admin')
  dismissSuggestion(@Param('sid') sid: string, @Request() req: AuthedRequest) {
    return this.suggestions.dismiss(sid, req.user.clientId, req.user);
  }

  @Post('suggestions/:sid/album')
  @Roles('Admin')
  linkSuggestionAlbum(@Param('sid') sid: string, @Body() dto: LinkSuggestionAlbumDto, @Request() req: AuthedRequest) {
    return this.suggestions.linkAlbum(sid, dto.albumId, req.user.clientId);
  }

  @Post('suggestions/:sid/used')
  @Roles('Admin')
  markSuggestionUsed(@Param('sid') sid: string, @Body() dto: MarkSuggestionUsedDto, @Request() req: AuthedRequest) {
    return this.suggestions.markUsed(sid, dto.communicationId, req.user.clientId, req.user);
  }

  @Get()
  list(@Request() req: AuthedRequest) {
    return this.communications.list(req.user.clientId, isAdmin(req));
  }

  /** How many people a send would reach now. Declared before `:id`. */
  @Get('audience')
  @Roles('Admin')
  audience(@Request() req: AuthedRequest) {
    return this.communications.audience(req.user.clientId);
  }

  @Get(':id')
  get(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.communications.get(id, req.user.clientId, isAdmin(req));
  }

  @Post()
  @Roles('Admin')
  create(@Body() dto: CreateCommunicationDto, @Request() req: AuthedRequest) {
    return this.communications.create(dto, req.user.clientId, req.user);
  }

  @Patch(':id')
  @Roles('Admin')
  update(@Param('id') id: string, @Body() dto: UpdateCommunicationDto, @Request() req: AuthedRequest) {
    return this.communications.update(id, dto, req.user.clientId, req.user);
  }

  @Delete(':id')
  @Roles('Admin')
  remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.communications.remove(id, req.user.clientId);
  }

  @Post(':id/send')
  @Roles('Admin')
  send(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.communications.sendNow(id, req.user.clientId);
  }

  @Post(':id/retry-failed')
  @Roles('Admin')
  retryFailed(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.communications.retryFailed(id, req.user.clientId);
  }

  @Post(':id/schedule')
  @Roles('Admin')
  schedule(@Param('id') id: string, @Body() dto: ScheduleCommunicationDto, @Request() req: AuthedRequest) {
    return this.communications.schedule(id, dto.scheduledAt, req.user.clientId, req.user);
  }

  @Post(':id/unschedule')
  @Roles('Admin')
  unschedule(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.communications.unschedule(id, req.user.clientId, req.user);
  }
}
