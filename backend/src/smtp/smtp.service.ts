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

  async getConfig() {
    const config = await this.prisma.smtpConfig.findUnique({ where: { id: 'global' } });
    if (!config) {
      return {
        host: null, port: 587, useTls: true, enabled: false,
        username: null, fromAddress: null, passwordSet: false,
      };
    }
    const { passwordEncrypted, ...rest } = config;
    return { ...rest, passwordSet: !!passwordEncrypted };
  }

  async upsertConfig(dto: UpsertSmtpConfigDto, actorId: string) {
    const data = {
      host: dto.host,
      port: dto.port,
      useTls: dto.useTls,
      enabled: dto.enabled,
      username: dto.username,
      fromAddress: dto.fromAddress,
      updatedBy: actorId,
      ...(dto.password ? { passwordEncrypted: encrypt(dto.password) } : {}),
    };

    await this.prisma.smtpConfig.upsert({
      where: { id: 'global' },
      update: data,
      create: { id: 'global', ...data },
    });

    return this.getConfig();
  }

  async testConnection() {
    try {
      const transporter = await this.mailer.getTransporter();
      await transporter.verify();
      return { success: true, message: 'Connection successful' };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Connection failed' };
    }
  }
}
