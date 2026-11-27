import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { UpsertSmtpConfigDto } from './dto/upsert-smtp-config.dto';
import { encrypt } from '../lib/encryption';

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
    try {
      await this.mailer.sendMail({
        to: address,
        subject: 'Test email — your mail settings are working',
        html:
          `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto">` +
          `<div style="background:#047857;padding:20px;border-radius:12px 12px 0 0;text-align:center">` +
          `<h1 style="color:#fff;margin:0;font-size:18px">Your mail settings are working</h1></div>` +
          `<div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;color:#374151;font-size:14px">` +
          `<p>This test email was sent from the ticketing system through <strong>${host ?? 'your mail server'}</strong>.</p>` +
          `<p>If you can read this, ticket emails will be delivered.</p>` +
          `<p style="color:#6b7280;font-size:12px">Sent ${when}</p></div></div>`,
        text: `Your mail settings are working.

This test email was sent from the ticketing system through ${host ?? 'your mail server'}. If you can read this, ticket emails will be delivered.

Sent ${when}`,
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
