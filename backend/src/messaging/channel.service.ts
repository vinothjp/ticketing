import { Injectable, BadRequestException } from '@nestjs/common';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService, TicketViewer } from '../tickets/tickets.service';
import { ActivityService } from '../activity/activity.service';
import { MailerService } from '../mail/mailer.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

@Injectable()
export class ChannelService {
  constructor(
    private prisma: PrismaService,
    private tickets: TicketsService,
    private activity: ActivityService,
    private mailer: MailerService,
  ) {}

  async listMessages(ticketId: string, clientId: string, viewer: TicketViewer) {
    await this.tickets.findOne(ticketId, clientId, viewer);
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

  /** Email the ticket's assigned technicians about an internal note (excludes the note's author). */
  private async notifyAssignedTechnicians(
    ticketId: string,
    ticketSubject: string,
    body: string,
    author: { username: string | null; email: string | null } | null,
    attachments: { filename: string; path: string }[],
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

    const subject = `Internal note · ${ticketSubject}`;
    try {
      if (await this.mailer.isConfigured()) {
        await this.mailer.sendMail({
          to: recipients.join(', '),
          subject,
          html: `<div style="white-space:pre-wrap;font-family:sans-serif">${escapeHtml(body)}</div>`,
          text: body,
          replyTo: author?.email ?? undefined,
          attachments,
        });
      } else {
        // Mock channel — logs instead of sending, so dev works without SMTP.
        console.log(`[MOCK EMAIL] to=${recipients.join(', ')} subject="${subject}"\n${body}`);
      }
    } catch (e) {
      // An internal-note email failure must not block saving the note.
      console.warn('[internal-note] failed to email assigned technicians:', e);
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
      // Internal notes go ONLY to the assigned technician(s) — never the customer.
      await this.notifyAssignedTechnicians(ticket.id, subject, input.body, author, attachments);
    }

    if (!internal) {
      toAddress = this.recipientEmail(ticket);
      if (!toAddress) throw new BadRequestException('No email address on file for the requester');
      try {
        if (await this.mailer.isConfigured()) {
          const res = await this.mailer.sendMail({
            to: toAddress,
            subject,
            html: `<div style="white-space:pre-wrap;font-family:sans-serif">${escapeHtml(input.body)}</div>`,
            text: input.body,
            replyTo: author?.email ?? undefined,
            attachments,
          });
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
      summary: internal ? 'Internal note added' : `Email reply sent${toAddress ? ` to ${toAddress}` : ''}`,
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
