import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_RULES, NotificationEvent, NotificationRuleInput } from './notification-vocab';

const SELECT = { id: true, event: true, recipients: true, email: true, bell: true, sortOrder: true } as const;

/**
 * The Email Configuration matrix — the one place that decides who hears of the
 * twelve ticket events, and how (`TicketsService.fireEvent` reads `forEvent`).
 */
@Injectable()
export class NotificationRulesService {
  constructor(private prisma: PrismaService) {}

  /** The tenant's rules in screen order; a tenant with none is seeded with the defaults. */
  async list(clientId: string) {
    const count = await this.prisma.notificationRule.count({ where: { clientId } });
    if (!count) {
      await this.prisma.notificationRule.createMany({
        data: DEFAULT_RULES.map((r, i) => ({ clientId, ...r, sortOrder: i })),
      });
    }
    return this.prisma.notificationRule.findMany({ where: { clientId }, orderBy: { sortOrder: 'asc' }, select: SELECT });
  }

  /** Every row for one event (an event may have several). Seeds a tenant that has none. */
  async forEvent(clientId: string, event: NotificationEvent) {
    return (await this.list(clientId)).filter((r) => r.event === event);
  }

  /** Replaces the whole matrix; row order is the array order. */
  async save(clientId: string, rules: NotificationRuleInput[]) {
    rules.forEach((r, i) => {
      if (!r.email && !r.bell) throw new BadRequestException(`Row ${i + 1}: tick Email, Bell or both`);
    });
    await this.prisma.$transaction([
      this.prisma.notificationRule.deleteMany({ where: { clientId } }),
      this.prisma.notificationRule.createMany({
        data: rules.map((r, i) => ({
          clientId,
          event: r.event,
          recipients: [...new Set(r.recipients)],
          email: r.email,
          bell: r.bell,
          sortOrder: i,
        })),
      }),
    ]);
    return this.prisma.notificationRule.findMany({ where: { clientId }, orderBy: { sortOrder: 'asc' }, select: SELECT });
  }
}
