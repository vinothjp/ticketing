import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TicketsService } from './tickets.service';

/**
 * Closes resolved tickets the client never acknowledged, once the tenant's
 * `ticketAutoCloseDays` window has passed. Same plain-interval pattern as
 * `AmcExpiryService` — no external scheduler needed. Hourly is fine for a
 * window measured in days: the worst case is a ticket closing an hour late.
 */
@Injectable()
export class TicketAutoCloseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TicketAutoCloseService.name);
  private timer?: NodeJS.Timeout;
  private readonly EVERY_MS = 60 * 60 * 1000; // hourly

  constructor(private tickets: TicketsService) {}

  onModuleInit() {
    // First sweep shortly after boot, then on the interval.
    setTimeout(() => void this.sweep(), 45_000);
    this.timer = setInterval(() => void this.sweep(), this.EVERY_MS);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    try {
      const { closed } = await this.tickets.autoCloseUnacknowledged();
      if (closed) this.logger.log(`Auto-closed ${closed} unacknowledged ticket(s)`);
    } catch (e) {
      this.logger.error(`Ticket auto-close sweep failed: ${(e as Error).message}`);
    }
  }
}
