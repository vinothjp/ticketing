import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelService } from './channel.service';
import { decrypt } from '../lib/encryption';

/**
 * Polls enabled EMAIL_IMAP channels for inbound replies and threads them onto tickets.
 * `imapflow` is imported lazily, so this is fully dormant (and needs no dependency) until
 * an admin configures + enables an IMAP mailbox. In mock/dev it never runs.
 */
@Injectable()
export class ImapPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImapPollerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private prisma: PrismaService, private channels: ChannelService) {}

  onModuleInit() {
    // Poll every 60s; each tick is a no-op unless a channel is enabled.
    this.timer = setInterval(() => void this.pollAll(), 60_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async pollAll() {
    if (this.running) return;
    this.running = true;
    try {
      const channels = await this.prisma.messagingChannel.findMany({
        where: { type: 'EMAIL_IMAP', enabled: true, configEncrypted: { not: null } },
      });
      for (const ch of channels) {
        try {
          await this.pollOne(ch.clientId, JSON.parse(decrypt(ch.configEncrypted!)));
        } catch (e) {
          this.logger.warn(`IMAP poll failed for client ${ch.clientId}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async pollOne(
    clientId: string,
    cfg: { host: string; port?: number; user: string; password: string; tls?: boolean },
  ) {
    let ImapFlow: any;
    try {
      // Indirect specifier so TS/bundler doesn't require the optional dep at build time.
      const specifier = 'imapflow';
      ({ ImapFlow } = (await import(specifier)) as any);
    } catch {
      this.logger.warn('imapflow is not installed — install it to enable inbound email polling.');
      return;
    }
    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port ?? 993,
      secure: cfg.tls ?? true,
      auth: { user: cfg.user, pass: cfg.password },
      logger: false,
    });
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        for await (const msg of client.fetch({ seen: false }, { envelope: true, source: true })) {
          const subject: string = msg.envelope?.subject ?? '';
          const from: string = msg.envelope?.from?.[0]?.address ?? 'unknown';
          const body = msg.source ? msg.source.toString() : '';
          try {
            await this.channels.receiveInbound({
              clientId,
              subject,
              from,
              body,
              externalId: msg.envelope?.messageId ?? undefined,
            });
            await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
          } catch {
            /* no matching ticket — leave unseen */
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }
}
