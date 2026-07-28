import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { ChannelService } from './channel.service';

/**
 * Public (unauthenticated) endpoints for inbound messages. Guards are intentionally
 * omitted (like AuthController); requests are authorized by a shared token instead.
 * The `simulate-inbound` endpoint lets you exercise email threading in dev without a
 * live mailbox. Real provider webhooks (WhatsApp/SMS) would be added here later.
 */
@Controller('api/webhooks')
export class WebhooksController {
  constructor(private channels: ChannelService) {}

  @Post('simulate-inbound')
  simulate(@Body() body: { token?: string; ticketNumber?: string; from?: string; subject?: string; body?: string }) {
    const expected = process.env.WEBHOOK_TOKEN ?? 'dev-webhook-token';
    if (body.token !== expected) throw new UnauthorizedException('Invalid webhook token');
    return this.channels.receiveInbound({
      ticketNumber: body.ticketNumber,
      subject: body.subject,
      from: body.from ?? 'requester@example.com',
      body: body.body ?? '',
      externalId: `sim-${Date.now()}`,
    });
  }
}
