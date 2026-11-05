import { BadRequestException } from '@nestjs/common';
import { ClientVisitsService, type VisitActor } from './client-visits.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

const CLIENT_ID = 'tenant-1';
const COMPANY_ID = 'company-1';
const PRODUCT_ID = 'product-1';
const CONSULTANT_ID = 'agent-5';

const admin: VisitActor = { id: 'admin-1', roles: ['Admin'] };
const consultant: VisitActor = { id: CONSULTANT_ID, roles: ['Viewer'] };

/**
 * A day well clear of "today", so the past-date rule never fires by accident.
 * Built at UTC midnight because that is what Prisma hands back for a `visitDate`
 * written from a plain `YYYY-MM-DD` — a local-midnight fixture would round to the
 * previous day in `toISOString()` and make same-day comparisons look unequal.
 */
const shiftDays = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

type VisitRow = Record<string, unknown>;

function visitRow(overrides: VisitRow = {}): VisitRow {
  return {
    id: 'visit-1',
    clientId: CLIENT_ID,
    visitNumber: 'CL-000001',
    visitDate: shiftDays(7),
    customerCompanyId: COMPANY_ID,
    consultantId: CONSULTANT_ID,
    consultantName: 'agent5',
    productId: PRODUCT_ID,
    productName: 'SAP B1',
    hours: 0,
    purpose: 'Health check',
    status: 'PLANNED',
    contractDeducted: false,
    deductedCpId: null,
    ...overrides,
  };
}

function build(visit: VisitRow, contractScope = 'PRODUCT') {
  const prisma = {
    clientVisit: {
      findFirst: jest.fn().mockResolvedValue(visit),
      update: jest.fn().mockImplementation(({ data }: { data: VisitRow }) => ({ ...visit, ...data })),
    },
    customerCompany: {
      findFirst: jest.fn().mockResolvedValue({ id: COMPANY_ID, name: 'Globex Ltd', contractScope }),
      // resolvePool() reads the coverage model through findUnique, not findFirst.
      findUnique: jest.fn().mockResolvedValue({ contractScope }),
      update: jest.fn().mockResolvedValue({}),
    },
    customerCompanyProduct: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cp-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ username: 'agent5' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'admin-2' }]),
    },
  };
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ClientVisitsService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, notifications };
}

/**
 * The edit form posts the *whole* visit back, including the status it is already
 * on. An earlier version keyed the "admin confirmed a new date" transition off
 * `!dto.status`, which is only ever true for a hand-written PATCH — so every save
 * from the real screen left the visit stuck on RESCHEDULE_REQUESTED, still showing
 * "Set new date". These tests use the form's payload shape for that reason.
 */
const formPayload = (visitDate: string, status: string) => ({
  visitDate,
  customerCompanyId: COMPANY_ID,
  consultantId: CONSULTANT_ID,
  productId: PRODUCT_ID,
  hours: 0,
  purpose: 'Health check',
  status,
});

describe('ClientVisitsService — confirming a reschedule', () => {
  it('moves the visit back to PLANNED when the edit form echoes the current status', async () => {
    const { service, prisma } = build(visitRow({ status: 'RESCHEDULE_REQUESTED' }));

    await service.update(
      CLIENT_ID,
      'visit-1',
      formPayload(iso(shiftDays(21)), 'RESCHEDULE_REQUESTED'),
      admin,
    );

    const data = prisma.clientVisit.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe('PLANNED');
    expect(data.rescheduleCount).toEqual({ increment: 1 });
  });

  it('also confirms when the payload omits the status entirely', async () => {
    const { service, prisma } = build(visitRow({ status: 'RESCHEDULE_REQUESTED' }));

    await service.update(CLIENT_ID, 'visit-1', { visitDate: iso(shiftDays(21)) }, admin);

    const data = prisma.clientVisit.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe('PLANNED');
  });

  it('tells the consultant the new date', async () => {
    const { service, notifications } = build(visitRow({ status: 'RESCHEDULE_REQUESTED' }));

    await service.update(
      CLIENT_ID,
      'visit-1',
      formPayload(iso(shiftDays(21)), 'RESCHEDULE_REQUESTED'),
      admin,
    );

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CLIENT_VISIT_RESCHEDULED', userId: CONSULTANT_ID }),
    );
  });

  it('leaves a deliberate move to another status alone', async () => {
    const { service, prisma } = build(visitRow({ status: 'RESCHEDULE_REQUESTED' }));

    await service.update(CLIENT_ID, 'visit-1', formPayload(iso(shiftDays(21)), 'VISITED'), admin);

    const data = prisma.clientVisit.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe('VISITED');
    expect(data.rescheduleCount).toBeUndefined();
  });

  it('refuses the date the visit already has', async () => {
    const existing = visitRow({ status: 'RESCHEDULE_REQUESTED' });
    const { service, prisma } = build(existing);

    await expect(
      service.update(
        CLIENT_ID,
        'visit-1',
        formPayload(iso(existing.visitDate as Date), 'RESCHEDULE_REQUESTED'),
        admin,
      ),
    ).rejects.toThrow(/pick a date other than the one it already has/);
    expect(prisma.clientVisit.update).not.toHaveBeenCalled();
  });

  it('refuses a new date in the past', async () => {
    const { service, prisma } = build(visitRow({ status: 'RESCHEDULE_REQUESTED' }));

    await expect(
      service.update(
        CLIENT_ID,
        'visit-1',
        formPayload(iso(shiftDays(-30)), 'RESCHEDULE_REQUESTED'),
        admin,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.clientVisit.update).not.toHaveBeenCalled();
  });
});

describe('ClientVisitsService — hours belong to the consultant', () => {
  it('lets an admin save a visit without ever stating hours', async () => {
    const { service, prisma } = build(visitRow({ hours: 0 }));

    await service.update(CLIENT_ID, 'visit-1', { purpose: 'Renamed' }, admin);

    expect(prisma.clientVisit.update).toHaveBeenCalled();
  });

  it('refuses a consultant reporting VISITED with no hours on the visit', async () => {
    const { service, prisma } = build(visitRow({ hours: 0 }));

    await expect(
      service.update(CLIENT_ID, 'visit-1', { status: 'VISITED' }, consultant),
    ).rejects.toThrow(/more than zero hours/);
    expect(prisma.clientVisit.update).not.toHaveBeenCalled();
  });

  it('accepts a reschedule request with zero hours, since nobody was on site', async () => {
    const { service, prisma } = build(visitRow({ hours: 0 }));

    await service.update(
      CLIENT_ID,
      'visit-1',
      { status: 'RESCHEDULE_REQUESTED', hours: 0 },
      consultant,
    );

    expect(prisma.clientVisit.update).toHaveBeenCalled();
  });
});

describe('ClientVisitsService — product follows the coverage model', () => {
  it('refuses a product-less visit on a per-product client', async () => {
    const { service, prisma } = build(visitRow({ productId: null, productName: null }), 'PRODUCT');

    await expect(
      service.update(CLIENT_ID, 'visit-1', { purpose: 'Renamed' }, admin),
    ).rejects.toThrow(/per-product coverage/);
    expect(prisma.clientVisit.update).not.toHaveBeenCalled();
  });

  it('allows a product-less visit on a shared customer contract', async () => {
    const { service, prisma } = build(visitRow({ productId: null, productName: null }), 'CUSTOMER');

    await service.update(CLIENT_ID, 'visit-1', { purpose: 'Renamed' }, admin);

    expect(prisma.clientVisit.update).toHaveBeenCalled();
  });
});
