import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService, TicketViewer } from '../tickets/tickets.service';
import { ActivityService } from '../activity/activity.service';
import { CreateCommentDto } from './dto/comment.dto';

/**
 * A customer contact belongs to a company; internal staff do not. Task comments
 * are hidden from that side, because the tasks themselves are.
 */
const isCustomerSide = (viewer: TicketViewer) => !!viewer.customerCompanyId;

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private tickets: TicketsService,
    private activity: ActivityService,
  ) {}

  /**
   * Every comment on the ticket — its own thread and its tasks' — in one call, so
   * the Comments tab groups them client-side without a request per task. Who may
   * see the ticket at all is `TicketsService.findOne`'s rule, customer-side
   * included; the only extra filter here is that tasks are staff-only.
   */
  async list(ticketId: string, clientId: string, viewer: TicketViewer, taskId?: string) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    return this.prisma.ticketComment.findMany({
      where: {
        ticketId,
        ...(taskId ? { taskId } : {}),
        ...(isCustomerSide(viewer) ? { taskId: null } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    ticketId: string,
    clientId: string,
    dto: CreateCommentDto,
    actorId: string,
    viewer: TicketViewer,
  ) {
    await this.tickets.findOne(ticketId, clientId, viewer);

    if (dto.taskId) {
      if (isCustomerSide(viewer)) {
        throw new ForbiddenException('Tasks are internal — comment on the ticket instead');
      }
      // Scoped to this ticket, so a task id from another ticket can't smuggle a
      // comment onto it.
      const task = await this.prisma.ticketTask.findFirst({
        where: { id: dto.taskId, ticketId },
        select: { id: true },
      });
      if (!task) throw new NotFoundException('Task not found');
    }

    const author = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { username: true },
    });
    const comment = await this.prisma.ticketComment.create({
      data: {
        ticketId,
        taskId: dto.taskId ?? null,
        authorUserId: actorId,
        // Denormalised at write time, like TicketMessage.authorName, so the list
        // needs no join.
        authorName: author?.username ?? null,
        body: dto.body.trim(),
      },
    });
    await this.activity.log({
      ticketId,
      actorUserId: actorId,
      type: 'COMMENT_ADDED',
      summary: dto.taskId ? 'Commented on a task' : 'Commented on the ticket',
      meta: { taskId: dto.taskId ?? null, commentId: comment.id },
    });
    return comment;
  }

  /** Only the author may take a comment back; a tenant Admin may remove any. */
  async remove(ticketId: string, commentId: string, clientId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    const comment = await this.prisma.ticketComment.findFirst({
      where: { id: commentId, ticketId },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorUserId !== viewer.id && !viewer.roles.includes('Admin')) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.prisma.ticketComment.delete({ where: { id: commentId } });
    return { message: 'Comment deleted' };
  }
}
