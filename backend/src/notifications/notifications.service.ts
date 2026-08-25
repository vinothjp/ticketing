import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type NewNotification = {
  clientId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  ticketId?: string;
  /** In-app route the bell opens; the ticket is used when this is absent. */
  link?: string;
};

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async notify(n: NewNotification) {
    return this.prisma.notification.create({ data: n });
  }

  /** Fan out the same notification to several users (de-duplicated). */
  async notifyMany(userIds: string[], n: Omit<NewNotification, 'userId'>) {
    const unique = [...new Set(userIds)].filter(Boolean);
    if (!unique.length) return;
    await this.prisma.notification.createMany({
      data: unique.map((userId) => ({ ...n, userId })),
    });
  }

  async listMine(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);
    return { items, unread };
  }

  async markRead(id: string, userId: string) {
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
    return { message: 'ok' };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    return { message: 'ok' };
  }
}
