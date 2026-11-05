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

  async testConnection(clientId?: string | null) {
    try {
      const transporter = await this.mailer.getTransporter(clientId);
      await transporter.verify();
      return { success: true, message: 'Connection successful' };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Connection failed' };
    }
  }
}
