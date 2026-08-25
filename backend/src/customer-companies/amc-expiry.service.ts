import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CustomerProductsService } from './customer-products.service';

// Periodically checks every customer's AMC coverage: fires the "running out"
// alert at 90% and terminates service once it fully lapses. Mirrors the IMAP
// poller pattern (a plain interval) — no external scheduler needed.
@Injectable()
export class AmcExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AmcExpiryService.name);
  private timer?: NodeJS.Timeout;
  private readonly EVERY_MS = 6 * 60 * 60 * 1000; // every 6 hours

  constructor(private customerProducts: CustomerProductsService) {}

  onModuleInit() {
    // First sweep shortly after boot, then on the interval.
    setTimeout(() => void this.sweep(), 30_000);
    this.timer = setInterval(() => void this.sweep(), this.EVERY_MS);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    try {
      const { scanned } = await this.customerProducts.runExpirySweep();
      if (scanned) this.logger.log(`AMC expiry sweep: checked ${scanned} product(s)`);
    } catch (e) {
      this.logger.error(`AMC expiry sweep failed: ${(e as Error).message}`);
    }
    try {
      const { created } = await this.customerProducts.rollForwardLedgers();
      if (created) this.logger.log(`Support-hours ledger: opened ${created} new month bucket(s)`);
    } catch (e) {
      this.logger.error(`Support-hours ledger roll-forward failed: ${(e as Error).message}`);
    }
  }
}
