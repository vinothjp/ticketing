import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/comment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = {
  user: { id: string; clientId: string; roles: string[]; customerCompanyId?: string | null };
};

/**
 * Comments on a ticket and on its tasks. No StaffGuard — everyone who can see
 * the ticket can join its thread, the customer's own contacts included, the same
 * way `messages.controller.ts` is reachable from both sides. Visibility is
 * `TicketsService.findOne`'s job; the service adds the one extra rule, that task
 * comments are staff-only.
 */
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/tickets/:ticketId/comments')
export class CommentsController {
  constructor(private comments: CommentsService) {}

  @Get()
  list(
    @Param('ticketId') ticketId: string,
    @Query('taskId') taskId: string | undefined,
    @Request() req: AuthedRequest,
  ) {
    return this.comments.list(ticketId, req.user.clientId, req.user, taskId);
  }

  @Post()
  create(
    @Param('ticketId') ticketId: string,
    @Body() dto: CreateCommentDto,
    @Request() req: AuthedRequest,
  ) {
    return this.comments.create(ticketId, req.user.clientId, dto, req.user.id, req.user);
  }

  @Delete(':commentId')
  remove(
    @Param('ticketId') ticketId: string,
    @Param('commentId') commentId: string,
    @Request() req: AuthedRequest,
  ) {
    return this.comments.remove(ticketId, commentId, req.user.clientId, req.user);
  }
}
