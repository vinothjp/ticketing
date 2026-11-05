import {
  Injectable, Logger, NotFoundException, BadRequestException, ConflictException,
  OnModuleInit, OnModuleDestroy,
} from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCommunicationDto, UpdateCommunicationDto } from './dto/communication.dto';

type Actor = { id: string; username?: string };
/** An attached album as the email draws it: its embedded photos carry a `cid`. */
type EmailAlbum = { id: string; title: string; photoCount: number; images: { cid: string; path: string }[] };

/** Photos embedded in one email, across all its albums — keeps every email small. */
const MAX_EMAIL_PHOTOS = 6;
/** Thumbnails shown per album on the in-app view. */
const VIEW_PHOTOS_PER_ALBUM = 6;

/** Only these can still be edited, rescheduled or deleted; anything later is a record. */
const OPEN = ['DRAFT', 'SCHEDULED'];
/** What staff (non-admins) may read: communications that have actually gone out. */
const PUBLISHED = ['SENDING', 'SENT'];
const KIND_LABEL: Record<string, string> = { ANNOUNCEMENT: 'Announcement', NEWSLETTER: 'Newsletter' };
/** Client-side logins are never "employees" — they are a client's people, not the provider's. */
const CUSTOMER_ROLES = ['CustomerAdmin', 'Customer'];
/**
 * Pause between emails. Providers cap the send rate (Mailtrap's sandbox refuses
 * more than about one a second, Gmail and Office 365 throttle too), and a big
 * send is background work anyway — 100 employees take under two minutes.
 */
const SEND_GAP_MS = 1000;
/** A refused email is retried after these waits before it is marked FAILED — rides out "slow down" replies. */
const RETRY_WAITS_MS = [3000, 10_000];
const SWEEP_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Communication emails and the monthly newsletter.
 *
 * An Admin writes one and sends it now or schedules it. Sending snapshots the
 * audience — every active internal staff member — into CommunicationRecipient
 * rows, drops an in-app notification on each, and then emails them **one at a
 * time, one recipient per email**, so no one sees anyone else's address and a
 * provider's rate limit isn't hit. Delivery runs in the background and is
 * resumable: a minute-sweep starts due scheduled sends and picks up any send a
 * restart interrupted, from the rows still PENDING.
 */
@Injectable()
export class CommunicationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommunicationsService.name);
  private timer?: NodeJS.Timeout;
  /** Sends being delivered by this process, so the sweep never runs a second copy. */
  private readonly inFlight = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    setTimeout(() => void this.sweep(), 20_000); // resume anything a restart cut short
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- reads ----------------------------------------------------------------

  async list(clientId: string, isAdmin: boolean) {
    return this.prisma.communication.findMany({
      where: { clientId, ...(isAdmin ? {} : { status: { in: PUBLISHED } }) },
      orderBy: [{ sentAt: { sort: 'desc', nulls: 'first' } }, { updatedAt: 'desc' }],
      select: {
        id: true, kind: true, subject: true, status: true, scheduledAt: true, sentAt: true,
        recipientCount: true, failedCount: true, createdByName: true, updatedAt: true,
      },
    });
  }

  async get(id: string, clientId: string, isAdmin: boolean) {
    const found = await this.prisma.communication.findFirst({ where: { id, clientId } });
    // A draft or a scheduled send is the admins' business until it goes out.
    if (!found || (!isAdmin && !PUBLISHED.includes(found.status))) throw new NotFoundException('Communication not found');
    const c = { ...found, albums: await this.albumsForView(clientId, found.albumIds) };
    if (!isAdmin) return c;
    const [counts, failed] = await Promise.all([
      this.prisma.communicationRecipient.groupBy({ by: ['status'], where: { communicationId: id }, _count: { _all: true } }),
      this.prisma.communicationRecipient.findMany({
        where: { communicationId: id, status: 'FAILED' },
        select: { name: true, email: true, error: true }, orderBy: { name: 'asc' },
      }),
    ]);
    const n = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;
    return { ...c, delivery: { sent: n('SENT'), failed: n('FAILED'), pending: n('PENDING'), failedList: failed } };
  }

  /** Who a send would reach right now — shown on the editor before the admin confirms. */
  async audience(clientId: string) {
    return { count: await this.prisma.user.count({ where: this.audienceWhere(clientId) }) };
  }

  // ---- writes (Admin) -------------------------------------------------------

  async create(dto: CreateCommunicationDto, clientId: string, actor: Actor) {
    const albumIds = await this.ownAlbums(clientId, dto.albumIds);
    return this.prisma.communication.create({
      data: {
        clientId, kind: dto.kind, subject: dto.subject.trim(), body: dto.body.trim(),
        ...(albumIds ? { albumIds } : {}),
        createdBy: actor.id, createdByName: actor.username ?? null, updatedBy: actor.id,
      },
    });
  }

  async update(id: string, dto: UpdateCommunicationDto, clientId: string, actor: Actor) {
    await this.getOpen(id, clientId);
    const albumIds = await this.ownAlbums(clientId, dto.albumIds);
    return this.prisma.communication.update({
      where: { id },
      data: {
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
        ...(albumIds ? { albumIds } : {}),
        updatedBy: actor.id,
      },
    });
  }

  async remove(id: string, clientId: string) {
    await this.getOpen(id, clientId);
    await this.prisma.communication.delete({ where: { id } });
    return { message: 'Communication deleted' };
  }

  async schedule(id: string, at: string, clientId: string, actor: Actor) {
    await this.getOpen(id, clientId);
    const when = new Date(at);
    if (when.getTime() <= Date.now() + 60_000) {
      throw new BadRequestException('Pick a time at least a minute from now — or use Send now');
    }
    return this.prisma.communication.update({
      where: { id }, data: { status: 'SCHEDULED', scheduledAt: when, updatedBy: actor.id },
    });
  }

  async unschedule(id: string, clientId: string, actor: Actor) {
    const c = await this.getOpen(id, clientId);
    if (c.status !== 'SCHEDULED') throw new BadRequestException('This communication is not scheduled');
    return this.prisma.communication.update({
      where: { id }, data: { status: 'DRAFT', scheduledAt: null, updatedBy: actor.id },
    });
  }

  async sendNow(id: string, clientId: string) {
    await this.getOpen(id, clientId);
    await this.start(id);
    return this.prisma.communication.findUnique({ where: { id } });
  }

  /**
   * Re-send the emails that failed (say, after the mail settings were fixed).
   * Only the FAILED rows go back to PENDING — nobody who already has it is
   * mailed twice, and no second in-app notification is raised.
   */
  async retryFailed(id: string, clientId: string) {
    const c = await this.prisma.communication.findFirst({ where: { id, clientId } });
    if (!c) throw new NotFoundException('Communication not found');
    if (c.status !== 'SENT') throw new BadRequestException('Only a finished send can be retried');
    const { count } = await this.prisma.communicationRecipient.updateMany({
      where: { communicationId: id, status: 'FAILED' }, data: { status: 'PENDING', error: null },
    });
    if (!count) throw new BadRequestException('Nothing failed — every email was delivered');
    await this.prisma.communication.update({ where: { id }, data: { status: 'SENDING' } });
    void this.deliver(id);
    return { retrying: count };
  }

  // ---- delivery -------------------------------------------------------------

  /**
   * Claim the communication and snapshot its audience in one transaction, so two
   * starters (Send now racing the schedule sweep) can't both send it, and a crash
   * can't leave it SENDING with nobody to send to. Then notify in-app and hand
   * the emails to the background deliverer.
   */
  private async start(id: string) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const c = await tx.communication.findUnique({ where: { id } });
      if (!c || !OPEN.includes(c.status)) return null;
      const people = await tx.user.findMany({
        where: this.audienceWhere(c.clientId),
        select: { id: true, name: true, username: true, email: true },
      });
      if (!people.length) throw new BadRequestException('There are no active staff to send this to');
      const won = await tx.communication.updateMany({
        where: { id, status: { in: OPEN } },
        data: { status: 'SENDING', sentAt: new Date(), recipientCount: people.length, failedCount: 0 },
      });
      if (!won.count) return null;
      await tx.communicationRecipient.createMany({
        data: people.map((p) => ({
          communicationId: id, userId: p.id, name: p.name?.trim() || p.username, email: p.email,
        })),
        skipDuplicates: true,
      });
      return { c, people };
    });
    if (!claimed) throw new ConflictException('This communication has already been sent');

    const { c, people } = claimed;
    await this.notifications.notifyMany(people.map((p) => p.id), {
      clientId: c.clientId,
      type: 'COMMUNICATION',
      title: `${KIND_LABEL[c.kind] ?? 'Announcement'}: ${c.subject}`,
      body: c.body.slice(0, 200),
      link: `/communications/${id}`,
    });
    void this.deliver(id);
  }

  /** Email every PENDING recipient, one per message, then settle the counts. Resumable. */
  private async deliver(id: string) {
    if (this.inFlight.has(id)) return;
    this.inFlight.add(id);
    try {
      const c = await this.prisma.communication.findUnique({
        where: { id }, include: { client: { select: { name: true } } },
      });
      if (!c || c.status !== 'SENDING') return;
      const configured = await this.mailer.isConfigured(c.clientId);
      // Albums are read once per send: every recipient gets the same photos.
      const albums = await this.albumsForEmail(c.clientId, c.albumIds);
      const html = this.renderEmail(c.kind, c.subject, c.body, c.client.name, id, albums);
      const text = c.body + this.albumsText(albums);
      const attachments = albums.flatMap((a) => a.images.map((img) => ({ filename: `${img.cid.split('@')[0]}.jpg`, path: img.path, cid: img.cid })));
      const subject = c.kind === 'NEWSLETTER' ? `${c.client.name} newsletter: ${c.subject}` : c.subject;

      for (;;) {
        const batch = await this.prisma.communicationRecipient.findMany({
          where: { communicationId: id, status: 'PENDING' }, take: 25,
        });
        if (!batch.length) break;
        for (const r of batch) {
          let status = 'SENT';
          let error: string | null = null;
          if (!configured) {
            status = 'FAILED';
            error = 'Email is not set up for your organization — delivered in the app only';
          } else {
            for (let attempt = 0; ; attempt++) {
              try {
                await this.mailer.sendMail({ to: r.email, subject, html, text, attachments }, c.clientId);
                status = 'SENT';
                error = null;
                break;
              } catch (e) {
                status = 'FAILED';
                error = ((e as Error).message || 'Send failed').slice(0, 300);
                if (attempt >= RETRY_WAITS_MS.length) break;
                await sleep(RETRY_WAITS_MS[attempt]);
              }
            }
          }
          await this.prisma.communicationRecipient.update({
            where: { id: r.id }, data: { status, error, sentAt: status === 'SENT' ? new Date() : null },
          });
          if (configured) await sleep(SEND_GAP_MS);
        }
      }

      const failed = await this.prisma.communicationRecipient.count({ where: { communicationId: id, status: 'FAILED' } });
      await this.prisma.communication.update({ where: { id }, data: { status: 'SENT', failedCount: failed } });
    } catch (e) {
      // Left SENDING with rows still PENDING; the next sweep resumes it.
      this.logger.error(`Communication ${id} delivery stopped: ${(e as Error).message}`);
    } finally {
      this.inFlight.delete(id);
    }
  }

  /** Start due scheduled sends; resume sends a restart interrupted. */
  private async sweep() {
    try {
      const due = await this.prisma.communication.findMany({
        where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } }, select: { id: true },
      });
      for (const { id } of due) {
        try { await this.start(id); } catch (e) {
          this.logger.warn(`Scheduled communication ${id} not sent: ${(e as Error).message}`);
        }
      }
      const stalled = await this.prisma.communication.findMany({ where: { status: 'SENDING' }, select: { id: true } });
      for (const { id } of stalled) if (!this.inFlight.has(id)) void this.deliver(id);
    } catch (e) {
      this.logger.error(`Communications sweep failed: ${(e as Error).message}`);
    }
  }

  // ---- helpers --------------------------------------------------------------

  /** Every active internal staff member of the tenant — never a client's people. */
  private audienceWhere(clientId: string) {
    return {
      clientId,
      isActive: true,
      customerCompanyId: null,
      NOT: { userRoles: { some: { role: { name: { in: CUSTOMER_ROLES } } } } },
    };
  }

  private async getOpen(id: string, clientId: string) {
    const c = await this.prisma.communication.findFirst({ where: { id, clientId } });
    if (!c) throw new NotFoundException('Communication not found');
    if (!OPEN.includes(c.status)) throw new BadRequestException('A sent communication can no longer be changed');
    return c;
  }

  // ---- albums ---------------------------------------------------------------

  /**
   * The albums a save names, checked to be this tenant's own and de-duplicated,
   * in the order given. `undefined` means the payload didn't mention albums.
   */
  private async ownAlbums(clientId: string, ids?: string[]) {
    if (ids === undefined) return undefined;
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const found = await this.prisma.galleryAlbum.findMany({ where: { clientId, id: { in: unique } }, select: { id: true } });
    if (found.length !== unique.length) throw new BadRequestException('One of the albums no longer exists');
    return unique;
  }

  /** Attached albums for the in-app view: each with a few thumbnails, cover first. Deleted albums drop out. */
  private async albumsForView(clientId: string, ids: string[]) {
    if (!ids.length) return [];
    const albums = await this.prisma.galleryAlbum.findMany({
      where: { clientId, id: { in: ids } },
      include: {
        _count: { select: { photos: true } },
        photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, thumbUrl: true } },
      },
    });
    const byId = new Map(albums.map((a) => [a.id, a]));
    return ids.flatMap((id) => {
      const a = byId.get(id);
      if (!a) return [];
      const photos = [...a.photos].sort((x, y) => Number(y.id === a.coverPhotoId) - Number(x.id === a.coverPhotoId));
      return [{
        id: a.id, title: a.title, category: a.category, eventDate: a.eventDate, photoCount: a._count.photos,
        photos: photos.slice(0, VIEW_PHOTOS_PER_ALBUM).map((p) => ({ id: p.id, thumbUrl: p.thumbUrl })),
      }];
    });
  }

  /**
   * Attached albums for the email, with the photos to embed — at most
   * MAX_EMAIL_PHOTOS in all, so an email never balloons. One album shows up to
   * six of its photos (cover first); several albums share the budget, each
   * starting with its cover, so every album gets at least one picture while
   * the budget lasts. Thumbnails are embedded (small, and already EXIF-free);
   * a file missing on disk is simply skipped.
   */
  private async albumsForEmail(clientId: string, ids: string[]): Promise<EmailAlbum[]> {
    const view = await this.albumsForView(clientId, ids);
    if (!view.length) return [];
    const perAlbum = Math.max(1, Math.floor(MAX_EMAIL_PHOTOS / view.length));
    let budget = MAX_EMAIL_PHOTOS;
    let n = 0;
    return view.map((a) => {
      const images: { cid: string; path: string }[] = [];
      for (const p of a.photos) {
        if (budget <= 0 || images.length >= perAlbum) break;
        const path = join(process.cwd(), p.thumbUrl.replace(/^\//, ''));
        if (!existsSync(path)) continue;
        images.push({ cid: `photo${n++}@gallery`, path });
        budget--;
      }
      return { id: a.id, title: a.title, photoCount: a.photoCount, images };
    });
  }

  /** The plain-text part's version of the albums: one line each, with its link when there is one. */
  private albumsText(albums: EmailAlbum[]) {
    if (!albums.length) return '';
    const base = process.env.FRONTEND_URL?.replace(/\/$/, '');
    return '\n\nPhotos:\n' + albums
      .map((a) => `- ${a.title} (${a.photoCount} photo${a.photoCount === 1 ? '' : 's'})${base ? `: ${base}/gallery/${a.id}` : ''}`)
      .join('\n');
  }

  /** The albums block of the email: per album a title, a two-column photo grid, and a "view all" link. */
  private albumsHtml(albums: EmailAlbum[]) {
    if (!albums.length) return '';
    const base = process.env.FRONTEND_URL?.replace(/\/$/, '');
    return albums.map((a) => {
      const rows: string[] = [];
      for (let i = 0; i < a.images.length; i += 2) {
        const cells = a.images.slice(i, i + 2).map((img) =>
          `<td style="padding:4px;width:50%;vertical-align:top;"><img src="cid:${img.cid}" alt="" width="264" style="display:block;width:100%;max-width:264px;height:auto;border-radius:6px;border:0;"></td>`);
        if (cells.length === 1) cells.push('<td style="padding:4px;width:50%;"></td>');
        rows.push(`<tr>${cells.join('')}</tr>`);
      }
      const more = a.photoCount > a.images.length && base
        ? `<a href="${base}/gallery/${a.id}" style="color:#4f46e5;font-size:13px;">View all ${a.photoCount} photos</a>`
        : base ? `<a href="${base}/gallery/${a.id}" style="color:#4f46e5;font-size:13px;">Open the album</a>` : '';
      return `
        <div style="margin:22px 0 0;padding-top:18px;border-top:1px solid #e5e7eb;">
          <div style="color:#111827;font-size:15px;font-weight:600;margin:0 0 8px;">${escapeHtml(a.title)}</div>
          ${rows.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows.join('')}</table>` : ''}
          ${more ? `<p style="margin:8px 0 0;">${more}</p>` : ''}
        </div>`;
    }).join('');
  }

  /** Plain text → a simple branded email: blank lines split paragraphs, single newlines break lines. */
  private renderEmail(kind: string, subject: string, body: string, orgName: string, id: string, albums: EmailAlbum[] = []) {
    const paragraphs = body
      .split(/\n\s*\n/)
      .map((p) => `<p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 14px;">${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('') + this.albumsHtml(albums);
    const base = process.env.FRONTEND_URL?.replace(/\/$/, '');
    const link = base
      ? `<p style="margin:20px 0 0;"><a href="${base}/communications/${id}" style="color:#4f46e5;font-size:13px;">Read it in the app</a></p>`
      : '';
    const accent = kind === 'NEWSLETTER' ? '#4f46e5' : '#0f766e';
    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:${accent};padding:22px 28px;border-radius:12px 12px 0 0;">
          <div style="color:#e0e7ff;font-size:12px;text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(orgName)} · ${KIND_LABEL[kind] ?? 'Announcement'}</div>
          <h1 style="color:#fff;margin:6px 0 0;font-size:20px;">${escapeHtml(subject)}</h1>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
          ${paragraphs}${link}
        </div>
      </div>`;
  }
}
