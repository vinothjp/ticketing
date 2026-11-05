import { Injectable, BadRequestException } from '@nestjs/common';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService, TicketViewer } from '../tickets/tickets.service';
import { ActivityService } from '../activity/activity.service';
import { MailerService } from '../mail/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A proper, branded HTML email for a ticket reply (greeting + body + signature).
function buildReplyEmail(o: {
  ticketNumber: string;
  subject: string;
  requestorName?: string | null;
  body: string;
  agentName?: string | null;
  orgName?: string | null;
  greeting?: string;
}) {
  const greeting = o.greeting ?? (o.requestorName?.trim() ? `Dear ${o.requestorName.trim()},` : 'Hello,');
  const agent = escapeHtml(o.agentName || 'Customer Service');
  const signature = [agent, o.orgName ? escapeHtml(o.orgName) : ''].filter(Boolean).join('<br/>');
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#374151;font-size:14px;line-height:1.6;">
    <div style="border-bottom:2px solid #4F46E5;padding-bottom:10px;margin-bottom:16px;">
      <div style="font-size:12px;color:#6b7280;">Ticket ${escapeHtml(o.ticketNumber)}</div>
      <div style="font-size:16px;font-weight:600;color:#111827;">${escapeHtml(o.subject)}</div>
    </div>
    <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
    <div style="white-space:pre-wrap;">${escapeHtml(o.body)}</div>
    <p style="margin:20px 0 0;">Regards,<br/>${signature}</p>
    <div style="border-top:1px solid #e5e7eb;margin-top:20px;padding-top:10px;font-size:11px;color:#9ca3af;">
      You're receiving this email about ticket ${escapeHtml(o.ticketNumber)}. Reply to this email to respond.
    </div>
  </div>`;
  const text = `${greeting}\n\n${o.body}\n\nRegards,\n${o.agentName || 'Customer Service'}${o.orgName ? `\n${o.orgName}` : ''}`;
  return { html, text };
}

@Injectable()
export class ChannelService {
  constructor(
    private prisma: PrismaService,
    private tickets: TicketsService,
    private activity: ActivityService,
    private mailer: MailerService,
    private notifications: NotificationsService,
  ) {}

  async listMessages(ticketId: string, clientId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
    // The chat thread (`isInternal`, channel INTERNAL) is shared with the client,
    // not agent-only: everyone who can see the ticket sees the whole thread. The
    // flag now only separates in-app chat from the emailed replies.
    return this.prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      include: { attachments: true },
    });
  }

  private recipientEmail(ticket: {
    requestorEmail?: string | null;
    notifyEmails?: string[];
    requestorContact?: string | null;
  }): string | null {
    if (ticket.requestorEmail && EMAIL_RE.test(ticket.requestorEmail)) return ticket.requestorEmail;
    if (ticket.notifyEmails?.length && EMAIL_RE.test(ticket.notifyEmails[0])) return ticket.notifyEmails[0];
    const c = ticket.requestorContact?.trim();
    if (c && EMAIL_RE.test(c)) return c;
    return null;
  }

  /** The requester's CURRENT email — follows the linked user's profile, falling back to the snapshot. */
  private async requesterEmail(ticket: {
    requestorUserId?: string | null;
    requestorEmail?: string | null;
    notifyEmails?: string[];
    requestorContact?: string | null;
  }): Promise<string | null> {
    if (ticket.requestorUserId) {
      const u = await this.prisma.user.findUnique({ where: { id: ticket.requestorUserId }, select: { email: true } });
      if (u?.email && EMAIL_RE.test(u.email)) return u.email;
    }
    return this.recipientEmail(ticket);
  }


  /** Email the ticket's assigned technicians about a chat message (excludes its author). */
  private async notifyAssignedTechnicians(
    ticketId: string,
    ticketSubject: string,
    body: string,
    author: { username: string | null; email: string | null } | null,
    attachments: { filename: string; path: string }[],
    clientId: string,
  ) {
    const techs = await this.prisma.ticketTechnician.findMany({
      where: { ticketId },
      include: { user: { select: { email: true } } },
    });
    const recipients = Array.from(
      new Set(
        techs
          .map((t) => t.user?.email)
          .filter((e): e is string => !!e && EMAIL_RE.test(e) && e !== author?.email),
      ),
    );
    if (recipients.length === 0) return;

    const subject = `Chat · ${ticketSubject}`;
    try {
      if (await this.mailer.isConfigured(clientId)) {
        await this.mailer.sendMail({
          to: recipients.join(', '),
          subject,
          html: `<div style="white-space:pre-wrap;font-family:sans-serif">${escapeHtml(body)}</div>`,
          text: body,
          replyTo: author?.email ?? undefined,
          attachments,
        }, clientId);
      } else {
        // Mock channel — logs instead of sending, so dev works without SMTP.
        console.log(`[MOCK EMAIL] to=${recipients.join(', ')} subject="${subject}"\n${body}`);
      }
    } catch (e) {
      // A chat email failure must not block saving the message.
      console.warn('[chat] failed to email assigned technicians:', e);
    }
  }

  /**
   * In-app bell notification for every provider-side user when a chat is posted:
   * the ticket's assigned agent(s) plus every tenant Admin, minus the author.
   * Never throws — a notification failure must not block saving the chat.
   */
  private async notifyProviderSideOfChat(
    ticket: { id: string; ticketNumber: string; subject: string; clientId: string },
    body: string,
    author: { id: string; username: string | null },
  ) {
    try {
      const [techs, admins] = await Promise.all([
        this.prisma.ticketTechnician.findMany({ where: { ticketId: ticket.id }, select: { userId: true } }),
        this.prisma.user.findMany({
          where: { clientId: ticket.clientId, isActive: true, userRoles: { some: { role: { name: 'Admin' } } } },
          select: { id: true },
        }),
      ]);
      const recipients = [...techs.map((t) => t.userId), ...admins.map((a) => a.id)].filter(
        (uid) => uid !== author.id,
      );
      const preview = body.trim().replace(/\s+/g, ' ');
      await this.notifications.notifyMany(recipients, {
        clientId: ticket.clientId,
        type: 'TICKET_CHAT',
        ticketId: ticket.id,
        // Land on the Conversation tab — the chat is not on the default tab.
        link: `/tickets/${ticket.id}?tab=conversation`,
        title: `New chat on ${ticket.ticketNumber}`,
        body: `${author.username ?? 'A colleague'} on ${ticket.ticketNumber} — ${ticket.subject}: ${
          preview.length > 140 ? `${preview.slice(0, 140)}…` : preview
        }`,
      });
    } catch (e) {
      console.warn('[chat] failed to notify provider-side users:', e);
    }
  }

  /**
   * In-app bell notification for the client's own people when staff post a chat:
   * the requester plus their company's admins. The chat is shared with the client
   * now, so a message they can see is a message they get told about.
   * Never throws — a notification failure must not block saving the chat.
   */
  private async notifyCustomerSideOfChat(
    ticket: { id: string; ticketNumber: string; subject: string; clientId: string; requestorUserId: string | null; customerCompanyId: string | null },
    body: string,
    authorName: string | null,
  ) {
    try {
      const recipients = new Set<string>();
      if (ticket.requestorUserId) recipients.add(ticket.requestorUserId);
      if (ticket.customerCompanyId) {
        const admins = await this.prisma.user.findMany({
          where: {
            clientId: ticket.clientId,
            customerCompanyId: ticket.customerCompanyId,
            isActive: true,
            userRoles: { some: { role: { name: 'CustomerAdmin' } } },
          },
          select: { id: true },
        });
        for (const a of admins) recipients.add(a.id);
      }
      if (recipients.size === 0) return;
      const preview = body.trim().replace(/\s+/g, ' ');
      await this.notifications.notifyMany([...recipients], {
        clientId: ticket.clientId,
        type: 'TICKET_CHAT',
        ticketId: ticket.id,
        link: `/tickets/${ticket.id}?tab=conversation`,
        title: `New chat on ${ticket.ticketNumber}`,
        body: `${authorName ?? 'Support'} on ${ticket.ticketNumber} — ${ticket.subject}: ${
          preview.length > 140 ? `${preview.slice(0, 140)}…` : preview
        }`,
      });
    } catch (e) {
      console.warn('[chat] failed to notify the customer side:', e);
    }
  }

  async sendReply(
    ticketId: string,
    clientId: string,
    input: { channel: string; body: string },
    files: Express.Multer.File[],
    actor: { id: string },
    viewer: TicketViewer,
  ) {
    const ticket = await this.tickets.findOne(ticketId, clientId, viewer);
    if (!input.body?.trim()) throw new BadRequestException('Message body is required');
    const internal = input.channel === 'INTERNAL';
    // Customer side = a company's own admin + its employees (a tenant Admin who
    // also carries a customer role is still staff).
    const viewerIsCustomerSide =
      (viewer.roles.includes('Customer') || viewer.roles.includes('CustomerAdmin')) &&
      !viewer.roles.includes('Admin');
    const author = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { username: true, email: true },
    });

    let status = 'SENT';
    let error: string | null = null;
    let externalId: string | undefined;
    let toAddress: string | null = null;
    const subject = `[${ticket.ticketNumber}] ${ticket.subject}`;
    const attachments = (files ?? []).map((f) => ({
      filename: f.originalname,
      path: join(process.cwd(), 'uploads/messages', f.filename),
    }));

    if (internal) {
      // The chat is shared with the client, so both sides hear about it: the
      // provider side always (assigned agents + tenant admins, minus the author),
      // and the client's own people whenever staff posted.
      await this.notifyAssignedTechnicians(ticket.id, subject, input.body, author, attachments, ticket.clientId);
      await this.notifyProviderSideOfChat(ticket, input.body, { id: actor.id, username: author?.username ?? null });
      if (!viewerIsCustomerSide) {
        await this.notifyCustomerSideOfChat(ticket, input.body, author?.username ?? null);
      }
    }

    if (!internal) {
      const senderIsCustomer = viewer.roles.includes('Customer') && !viewer.roles.includes('Admin');
      const org = await this.prisma.client.findUnique({ where: { id: ticket.clientId }, select: { name: true } });

      let recipients: string[];
      let greetName: string | null = null;
      let greeting: string | undefined;
      let signerName: string | undefined;
      let signerOrg: string | null | undefined;

      if (senderIsCustomer) {
        // A customer's message goes to the assigned support agent(s), greeting them by name.
        const techs = await this.prisma.ticketTechnician.findMany({
          where: { ticketId },
          include: { user: { select: { email: true, username: true } } },
        });
        recipients = Array.from(new Set(techs.map((t) => t.user?.email).filter((e): e is string => !!e && EMAIL_RE.test(e))));
        const names = Array.from(new Set(techs.map((t) => t.user?.username).filter((n): n is string => !!n)));
        greeting = `Hello ${names.length ? names.join(', ') : 'team'},`;
        signerName = author?.username ?? 'Customer';
        signerOrg = ticket.customerCompany?.name ?? null;
      } else {
        // An agent's reply goes to the requester's CURRENT email, signed by the agent + org.
        const live = await this.requesterEmail(ticket);
        if (!live) throw new BadRequestException('No email address on file for the requester');
        recipients = [live];
        greetName = ticket.requestorName ?? null;
        signerName = author?.username;
        signerOrg = org?.name;
      }

      if (recipients.length === 0) {
        // Customer replied on an unassigned ticket — nobody to email; the message is still recorded.
        externalId = `nomail-${Date.now()}`;
      } else {
        toAddress = recipients.join(', ');
        const { html, text } = buildReplyEmail({
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          requestorName: greetName,
          greeting,
          body: input.body,
          agentName: signerName,
          orgName: signerOrg,
        });
        try {
          if (await this.mailer.isConfigured(ticket.clientId)) {
            const res = await this.mailer.sendMail({
              to: toAddress,
              subject,
              html,
              text,
              replyTo: author?.email ?? undefined,
              attachments,
            }, ticket.clientId);
            externalId = res.messageId;
          } else {
            // Mock channel — logs instead of sending, so dev works without SMTP.
            console.log(`[MOCK EMAIL] to=${toAddress} subject="${subject}"\n${input.body}`);
            externalId = `mock-${Date.now()}`;
          }
        } catch (e) {
          status = 'FAILED';
          error = e instanceof Error ? e.message : 'send failed';
        }
      }
    }

    const message = await this.prisma.ticketMessage.create({
      data: {
        ticketId,
        channel: internal ? 'INTERNAL' : 'EMAIL',
        direction: 'OUTBOUND',
        isInternal: internal,
        authorUserId: actor.id,
        authorName: author?.username ?? null,
        fromAddress: author?.email ?? null,
        toAddress,
        subject: internal ? null : subject,
        body: input.body,
        externalId,
        status,
        error,
        attachments: files?.length
          ? {
              create: files.map((f) => ({
                fileName: f.originalname,
                filePath: `/uploads/messages/${f.filename}`,
                mimeType: f.mimetype,
                size: f.size,
              })),
            }
          : undefined,
      },
      include: { attachments: true },
    });

    await this.activity.log({
      ticketId,
      actorUserId: actor.id,
      type: 'MESSAGE_SENT',
      summary: internal ? 'Chat message posted' : `Email reply sent${toAddress ? ` to ${toAddress}` : ''}`,
    });

    if (!internal && status === 'SENT' && !ticket.firstResponseAt) {
      await this.prisma.ticket.update({ where: { id: ticketId }, data: { firstResponseAt: new Date() } });
    }

    return message;
  }

  /** Store an inbound email onto the matching ticket (from IMAP poller or the dev simulate endpoint). */
  async receiveInbound(input: {
    ticketNumber?: string;
    clientId?: string;
    from: string;
    body: string;
    subject?: string;
    externalId?: string;
  }) {
    const num = input.ticketNumber ?? input.subject?.match(/TCK-\d{6}/)?.[0];
    if (!num) throw new BadRequestException('Could not determine the ticket');
    const ticket = await this.prisma.ticket.findFirst({
      where: { ticketNumber: num, ...(input.clientId ? { clientId: input.clientId } : {}) },
    });
    if (!ticket) throw new BadRequestException(`No ticket matching ${num}`);

    if (input.externalId) {
      const dup = await this.prisma.ticketMessage.findFirst({ where: { externalId: input.externalId } });
      if (dup) return dup;
    }

    const message = await this.prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        channel: 'EMAIL',
        direction: 'INBOUND',
        fromAddress: input.from,
        subject: input.subject,
        body: input.body,
        externalId: input.externalId,
        status: 'DELIVERED',
      },
    });
    await this.activity.log({
      ticketId: ticket.id,
      type: 'MESSAGE_RECEIVED',
      summary: `Email received from ${input.from}`,
    });
    return message;
  }
}
