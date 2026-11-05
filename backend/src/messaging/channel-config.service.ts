import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt } from '../lib/encryption';

export interface UpsertChannelDto {
  type: string; // EMAIL_IMAP
  provider?: string;
  enabled?: boolean;
  fromIdentity?: string;
  config?: Record<string, unknown>;
}

@Injectable()
export class ChannelConfigService {
  constructor(private prisma: PrismaService) {}

  async list(clientId: string) {
    const rows = await this.prisma.messagingChannel.findMany({ where: { clientId } });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      provider: r.provider,
      enabled: r.enabled,
      fromIdentity: r.fromIdentity,
      configured: !!r.configEncrypted,
    }));
  }

  async upsert(clientId: string, dto: UpsertChannelDto, actorId: string) {
    const data = {
      provider: dto.provider ?? 'imap',
      enabled: dto.enabled ?? false,
      fromIdentity: dto.fromIdentity,
      updatedBy: actorId,
      ...(dto.config ? { configEncrypted: encrypt(JSON.stringify(dto.config)) } : {}),
    };
    const row = await this.prisma.messagingChannel.upsert({
      where: { clientId_type: { clientId, type: dto.type } },
      update: data,
      create: { clientId, type: dto.type, ...data },
    });
    return { id: row.id, type: row.type, enabled: row.enabled, configured: !!row.configEncrypted };
  }
}
