import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type Actor = { id: string };
type ProjectRef = { id: string; clientId: string; name: string; description?: string | null; customerCompanyId: string | null };

const GO_LIVE = /go[\s-]?live/i;

/**
 * "Announce this?" prompts. Projects calls the three `on…` hooks when something
 * worth announcing happens; each raises at most one suggestion per event (the
 * unique `sourceKey`), tells the tenant's Admins through the bell, and waits on
 * the Communications screen until an Admin uses or dismisses it. Nothing here
 * ever sends anything.
 *
 * The hooks are best-effort: they swallow their own failures, so a project save
 * can never fail because a prompt couldn't be raised.
 */
@Injectable()
export class AnnouncementSuggestionsService {
  private readonly logger = new Logger(AnnouncementSuggestionsService.name);

  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  // ---- hooks (called by ProjectsService) ------------------------------------

  async onProjectCreated(p: ProjectRef) {
    const client = await this.clientName(p.customerCompanyId);
    await this.raise(p.clientId, {
      sourceKey: `project-created:${p.id}`,
      kind: 'PROJECT_CREATED',
      category: 'PROJECT_INITIATIVE',
      title: `New project: ${p.name}${client ? ` for ${client}` : ''}`,
      body: [
        `We've started a new project — ${p.name}${client ? ` for ${client}` : ''}.`,
        p.description?.trim(),
        'Wishing the team every success.',
      ].filter(Boolean).join('\n\n'),
      projectId: p.id, customerCompanyId: p.customerCompanyId,
    });
  }

  async onMilestoneApproved(
    m: { id: string; name: string; approverName: string | null },
    p: ProjectRef,
  ) {
    const client = await this.clientName(p.customerCompanyId);
    const at = client ? ` at ${client}` : '';
    const goLive = GO_LIVE.test(m.name);
    await this.raise(p.clientId, goLive
      ? {
          sourceKey: `milestone-approved:${m.id}`,
          kind: 'MILESTONE_APPROVED',
          category: 'CLIENT_ACHIEVEMENT',
          title: `${p.name} is live${at}`,
          body: `${p.name} has gone live${at}. Congratulations to the whole team!`,
          projectId: p.id, milestoneId: m.id, customerCompanyId: p.customerCompanyId,
        }
      : {
          sourceKey: `milestone-approved:${m.id}`,
          kind: 'MILESTONE_APPROVED',
          category: 'UAT_SIGNOFF',
          title: `${m.name} signed off — ${p.name}`,
          body: `The ${m.name} milestone for ${p.name}${at} has been signed off${m.approverName ? ` by ${m.approverName}` : ''}. Thank you to the team for all the hard work.`,
          projectId: p.id, milestoneId: m.id, customerCompanyId: p.customerCompanyId,
        });
  }

  async onProjectCompleted(p: ProjectRef) {
    const client = await this.clientName(p.customerCompanyId);
    await this.raise(p.clientId, {
      sourceKey: `project-completed:${p.id}`,
      kind: 'PROJECT_COMPLETED',
      category: 'CLIENT_ACHIEVEMENT',
      title: `${p.name} completed${client ? ` for ${client}` : ''}`,
      body: `${p.name}${client ? ` for ${client}` : ''} is complete. Thank you to everyone who made it happen!`,
      projectId: p.id, customerCompanyId: p.customerCompanyId,
    });
  }

  // ---- the Communications screen (Admin) ------------------------------------

  listPending(clientId: string) {
    return this.prisma.announcementSuggestion.findMany({
      where: { clientId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, clientId: string) {
    const s = await this.prisma.announcementSuggestion.findFirst({ where: { id, clientId } });
    if (!s) throw new NotFoundException('Suggestion not found');
    return s;
  }

  async dismiss(id: string, clientId: string, actor: Actor) {
    await this.pending(id, clientId);
    return this.prisma.announcementSuggestion.update({
      where: { id }, data: { status: 'DISMISSED', decidedBy: actor.id, decidedAt: new Date() },
    });
  }

  /** "Add photos & announce" made an album for it: remember it, so a second click continues rather than duplicates. */
  async linkAlbum(id: string, albumId: string, clientId: string) {
    await this.pending(id, clientId);
    if (!(await this.prisma.galleryAlbum.count({ where: { id: albumId, clientId } }))) {
      throw new BadRequestException('Album not found');
    }
    return this.prisma.announcementSuggestion.update({ where: { id }, data: { albumId } });
  }

  /** An announcement was written from it — it has done its job and leaves the list. */
  async markUsed(id: string, communicationId: string, clientId: string, actor: Actor) {
    await this.pending(id, clientId);
    if (!(await this.prisma.communication.count({ where: { id: communicationId, clientId } }))) {
      throw new BadRequestException('Communication not found');
    }
    return this.prisma.announcementSuggestion.update({
      where: { id }, data: { status: 'USED', communicationId, decidedBy: actor.id, decidedAt: new Date() },
    });
  }

  // ---- helpers --------------------------------------------------------------

  private async raise(
    clientId: string,
    s: {
      sourceKey: string; kind: string; category: string; title: string; body: string;
      projectId?: string; milestoneId?: string; customerCompanyId?: string | null;
    },
  ) {
    try {
      const created = await this.prisma.announcementSuggestion.create({
        data: { clientId, ...s, customerCompanyId: s.customerCompanyId ?? null },
      });
      const admins = await this.prisma.user.findMany({
        where: { clientId, isActive: true, customerCompanyId: null, userRoles: { some: { role: { name: 'Admin' } } } },
        select: { id: true },
      });
      await this.notifications.notifyMany(admins.map((a) => a.id), {
        clientId,
        type: 'ANNOUNCEMENT_SUGGESTION',
        title: `Announce this? ${created.title}`,
        body: 'A suggested announcement is waiting on the Communications screen.',
        link: '/communications',
      });
    } catch (e) {
      // Already suggested for this event — the whole point of the unique key.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      this.logger.warn(`Announcement suggestion "${s.sourceKey}" not raised: ${(e as Error).message}`);
    }
  }

  private async pending(id: string, clientId: string) {
    const s = await this.get(id, clientId);
    if (s.status !== 'PENDING') throw new BadRequestException('This suggestion has already been used or dismissed');
    return s;
  }

  private async clientName(customerCompanyId: string | null) {
    if (!customerCompanyId) return null;
    return (await this.prisma.customerCompany.findUnique({ where: { id: customerCompanyId }, select: { name: true } }))?.name ?? null;
  }
}
