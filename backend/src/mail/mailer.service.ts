import { Injectable, BadRequestException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt } from '../lib/encryption';
import { renderLetter } from '../lib/letter-email';

@Injectable()
export class MailerService {
  constructor(private prisma: PrismaService) {}

  /** Effective SMTP config for a client: the client's own if enabled+complete, else the global fallback. */
  private async resolveConfig(clientId?: string | null) {
    const complete = (c: { host?: string | null; username?: string | null; passwordEncrypted?: string | null; enabled?: boolean } | null) =>
      !!(c?.host && c.username && c.passwordEncrypted && c.enabled);

    if (clientId) {
      const tenant = await this.prisma.smtpConfig.findUnique({ where: { clientId } });
      if (complete(tenant)) return tenant;
    }
    const global = await this.prisma.smtpConfig.findUnique({ where: { id: 'global' } });
    return complete(global) ? global : null;
  }

  async getTransporter(clientId?: string | null) {
    const config = await this.resolveConfig(clientId);
    if (!config) {
      throw new BadRequestException('SMTP is not configured');
    }

    return nodemailer.createTransport({
      host: config.host!,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.useTls && config.port !== 465,
      auth: { user: config.username!, pass: decrypt(config.passwordEncrypted!) },
    });
  }

  async sendMail(options: {
    to: string;
    cc?: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    headers?: Record<string, string>;
    // `cid` embeds the attachment in the HTML (<img src="cid:…">) instead of listing it as a file.
    attachments?: { filename: string; path: string; cid?: string }[];
  }, clientId?: string | null): Promise<{ messageId?: string }> {
    const config = await this.resolveConfig(clientId);
    const transporter = await this.getTransporter(clientId);
    const info = await transporter.sendMail({
      from: config?.fromAddress || config?.username || undefined,
      to: options.to,
      ...(options.cc ? { cc: options.cc } : {}),
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      headers: options.headers,
      attachments: options.attachments,
    });
    return { messageId: (info as { messageId?: string })?.messageId };
  }

  /** The address the effective config sends as — where a connection test mails its proof. */
  async senderAddress(clientId?: string | null): Promise<{ address: string | null; host: string | null }> {
    const config = await this.resolveConfig(clientId);
    return { address: config?.fromAddress || config?.username || null, host: config?.host ?? null };
  }

  /** Whether SMTP is configured + enabled for this client (or the global fallback). */
  async isConfigured(clientId?: string | null): Promise<boolean> {
    return !!(await this.resolveConfig(clientId));
  }

  async sendPasswordResetEmail(to: string, username: string, resetUrl: string, clientId?: string | null) {
    const org = clientId
      ? await this.prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }).catch(() => null)
      : null;
    const { html, text } = renderLetter({
      greetName: username,
      intro: 'We have received a request to reset the password for your support portal account.\n' +
        'Please use the link below to choose a new password. For your security, the link expires in 1 hour.',
      table: { heading: 'Account Details', rows: [['Username', username], ['Email', to]] },
      outro: 'If you did not request a password reset, please ignore this email — your password will remain unchanged.',
      link: { label: 'Reset Password', url: resetUrl },
      orgName: org?.name,
    });
    await this.sendMail({ to, subject: '[Password Reset] - Support Portal', html, text }, clientId);
  }
}
