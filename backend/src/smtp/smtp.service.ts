import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { UpsertSmtpConfigDto } from './dto/upsert-smtp-config.dto';
import { encrypt } from '../lib/encryption';
import { renderLetter } from '../lib/letter-email';

@Injectable()
export class SmtpService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

  // A tenant's config is keyed by clientId; the platform-global fallback is id "global".
  private whereFor(clientId?: string | null) {
    return clientId ? { clientId } : { id: 'global' };
  }

  async getConfig(clientId?: string | null) {
    const config = await this.prisma.smtpConfig.findUnique({ where: this.whereFor(clientId) });
    if (!config) {
      return {
        host: null, port: 587, useTls: true, enabled: false,
        username: null, fromAddress: null, passwordSet: false,
      };
    }
    const { passwordEncrypted, ...rest } = config;
    return { ...rest, passwordSet: !!passwordEncrypted };
  }

  async upsertConfig(dto: UpsertSmtpConfigDto, actorId: string, clientId?: string | null) {
    // Trim stray whitespace — a pasted leading/trailing space in host/username
    // breaks DNS resolution and auth with a confusing ENOTFOUND.
    const data = {
      host: dto.host?.trim(),
      port: dto.port,
      useTls: dto.useTls,
      enabled: dto.enabled,
      username: dto.username?.trim(),
      fromAddress: dto.fromAddress?.trim(),
      updatedBy: actorId,
      ...(dto.password ? { passwordEncrypted: encrypt(dto.password.trim()) } : {}),
    };

    await this.prisma.smtpConfig.upsert({
      where: this.whereFor(clientId),
      update: data,
      // Tenant rows carry clientId (uuid id auto-generated); the global row keeps id "global".
      create: clientId ? { clientId, ...data } : { id: 'global', ...data },
    });

    return this.getConfig(clientId);
  }

  /**
   * Log in to the mail server, then prove it end to end: send a short test email
   * to the settings' own address (From address, else the username) through the
   * same config (client request). A login that works but a send that is refused
   * is reported as a failure — the admin needs to know mail won't go out.
   */
  async testConnection(clientId?: string | null) {
    try {
      const transporter = await this.mailer.getTransporter(clientId);
      await transporter.verify();
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Connection failed' };
    }
    const { address, host } = await this.mailer.senderAddress(clientId);
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return { success: true, message: 'Connection successful (no From address to send a test email to)' };
    }
    const when = new Date().toUTCString();
    const org = clientId
      ? await this.prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }).catch(() => null)
      : null;
    const { html, text } = renderLetter({
      fallbackGreeting: 'Administrator',
      intro: 'This is a test email from the ticketing system to confirm that your mail settings are working.\n' +
        'As you have received it, ticket notifications and other system emails will be delivered successfully.',
      table: {
        heading: 'Connection Details',
        rows: [
          ['Mail Server', host ?? 'Your mail server'],
          ['Sent To', address],
          ['Sent At', when],
          ['Settings', clientId ? 'Organization email settings' : 'Platform (global) email settings'],
        ],
      },
      outro: 'No action is required. If you did not run this test, please review the email configuration in the portal.',
      orgName: org?.name,
    });
    try {
      await this.mailer.sendMail({
        to: address,
        subject: '[Test Email] - Mail settings are working',
        html,
        text,
      }, clientId);
      return { success: true, message: `Connection successful — a test email was sent to ${address}` };
    } catch (err) {
      return {
        success: false,
        message: `Connected, but the test email to ${address} could not be sent: ${err instanceof Error ? err.message : 'unknown error'}`,
      };
    }
  }
}
