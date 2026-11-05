import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ActivityInput {
  ticketId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  type: string;
  summary: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  /** Records one audit entry. Best-effort — logged after the operation, not inside its transaction. */
  log(input: ActivityInput) {
    return this.prisma.ticketActivity.create({
      data: {
        ticketId: input.ticketId,
        actorUserId: input.actorUserId ?? null,
        actorName: input.actorName ?? null,
        type: input.type,
        summary: input.summary,
        meta: (input.meta as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
  }

  list(ticketId: string) {
    return this.prisma.ticketActivity.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
