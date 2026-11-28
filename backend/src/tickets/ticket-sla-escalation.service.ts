import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TicketsService } from './tickets.service';

/**
 * Escalates tickets that ran past their SLA due date to the client product's
 * project manager (else the tenant Admins) — `TicketsService.escalateBreachedSla`.
 * Same plain-interval pattern as `TicketAutoCloseService`; hourly means an
 * escalation goes out within the hour of the breach.
 */
@Injectable()
export class TicketSlaEscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TicketSlaEscalationService.name);
  private timer?: NodeJS.Timeout;
  private readonly EVERY_MS = 60 * 60 * 1000; // hourly

  constructor(private tickets: TicketsService) {}

  onModuleInit() {
    // First sweep shortly after boot (after the auto-close one), then hourly.
    setTimeout(() => void this.sweep(), 60_000);
    this.timer = setInterval(() => void this.sweep(), this.EVERY_MS);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    try {
      const { escalated } = await this.tickets.escalateBreachedSla();
      if (escalated) this.logger.log(`Escalated ${escalated} ticket(s) past their SLA`);
    } catch (e) {
      this.logger.error(`SLA escalation sweep failed: ${(e as Error).message}`);
    }
  }
}
