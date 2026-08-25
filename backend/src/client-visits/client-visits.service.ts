import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateClientVisitDto, UpdateClientVisitDto, VISIT_STATUS_LABELS } from './dto/client-visit.dto';

/** The one status that books a visit against the customer's visit allowance. */
const DEDUCTING_STATUS = 'VISITED';

/** The status a visit sits in while it is still waiting for a date from an admin. */
const RESCHEDULE_REQUESTED = 'RESCHEDULE_REQUESTED';

/** Midnight today — the earliest a visit that hasn't happened yet can be booked. */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Whoever is acting on a visit; a non-Admin is treated as the assigned consultant. */
export type VisitActor = { id: string; roles: string[] };

const isAdmin = (a: VisitActor) => a.roles.includes('Admin');

/**
 * What a consultant may change on their own visit: they report back on the work,
 * they don't re-plan it. Everything else (client, product, date, who it belongs
 * to) stays the admin's call.
 */
const CONSULTANT_EDITABLE = ['hours', 'status', 'notes'] as const;

@Injectable()
export class ClientVisitsService {
  private readonly logger = new Logger(ClientVisitsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /** Resolve a consultant inside this tenant; denormalised onto the visit for listing. */
  private async consultantName(clientId: string, consultantId: string) {
    const consultant = await this.prisma.user.findFirst({
      where: { id: consultantId, clientId },
      select: { username: true },
    });
    if (!consultant) throw new BadRequestException('Consultant not found');
    return consultant.username;
  }

  /** Resolve a product the customer actually owns; denormalised onto the visit. */
  private async productName(clientId: string, customerCompanyId: string, productId: string) {
    const owned = await this.prisma.customerCompanyProduct.findFirst({
      where: { customerCompanyId, productId, product: { clientId } },
      select: { product: { select: { name: true } } },
    });
    if (!owned) throw new BadRequestException('Product is not assigned to this customer');
    return owned.product?.name ?? null;
  }

  /**
   * Guard the customer company against the tenant; returns its name for
   * notifications and its `contractScope`, which decides whether a visit has to
   * name a product.
   */
  private async assertCompany(clientId: string, customerCompanyId: string) {
    const company = await this.prisma.customerCompany.findFirst({
      where: { id: customerCompanyId, clientId },
      select: { id: true, name: true, contractScope: true },
    });
    if (!company) throw new BadRequestException('Customer company not found');
    return company;
  }

  /**
   * Whether this visit has to name a product, decided by the client's coverage
   * model — the same split `resolvePool` deducts on:
   *
   * - `PRODUCT` — each product carries its own AMC/warranty allowance, so the
   *   visit must say which one it spends. Without a product there is no honest
   *   place to book it: it would silently land on the shared contract, a pool
   *   nobody on per-product coverage is tracking.
   * - `CUSTOMER` — one pooled contract covers everything, so the product is
   *   optional and every visit draws from that single allowance.
   */
  private assertProductForScope(
    company: { name: string; contractScope: string },
    productId?: string | null,
  ) {
    if (company.contractScope === 'PRODUCT' && !productId) {
      throw new BadRequestException(
        `${company.name} is on per-product coverage, so a visit must name the product it is booked against`,
      );
    }
  }

  /**
   * Tell a consultant a visit is now theirs. Best-effort: a notification failure
   * must never fail the visit write, so this swallows and logs.
   */
  private async notifyConsultant(p: {
    clientId: string;
    consultantId: string;
    actorId: string;
    visitId: string;
    visitNumber: string | null;
    visitDate: Date;
    companyName: string;
    purpose: string;
  }) {
    if (p.consultantId === p.actorId) return; // an admin assigning themselves needs no ping
    const when = p.visitDate.toISOString().slice(0, 10);
    const label = p.visitNumber ? `${p.visitNumber} — ` : '';
    try {
      await this.notifications.notify({
        clientId: p.clientId,
        userId: p.consultantId,
        type: 'CLIENT_VISIT_ASSIGNED',
        // Deliberately no `ticketId`: this notification is about the visit, and
        // setting it would send the bell to the ticket screen instead.
        link: `/client-visits?visit=${p.visitId}`,
        title: 'Client visit assigned to you',
        body: `${label}${p.companyName} on ${when}: ${p.purpose}`,
      });
    } catch (err) {
      this.logger.error(
        'Failed to notify consultant of client visit assignment',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Tell the assigned consultant their visit moved to a new date. This is the
   * closing half of a reschedule: they declined a slot, an admin picked another,
   * and they need the new one — a hand-over notification would not fire here,
   * because the visit never changed hands. Best-effort, same as the others.
   */
  private async notifyDateChange(p: {
    clientId: string;
    consultantId: string;
    actorId: string;
    visitId: string;
    visitNumber: string | null;
    visitDate: Date;
    companyName: string;
    wasRescheduled: boolean;
  }) {
    if (p.consultantId === p.actorId) return; // an admin moving their own visit knows
    const when = p.visitDate.toISOString().slice(0, 10);
    const label = p.visitNumber ? `${p.visitNumber} — ` : '';
    try {
      await this.notifications.notify({
        clientId: p.clientId,
        userId: p.consultantId,
        type: 'CLIENT_VISIT_RESCHEDULED',
        link: `/client-visits?visit=${p.visitId}`,
        title: p.wasRescheduled ? 'Your rescheduled visit has a new date' : 'Client visit moved',
        body: `${label}${p.companyName} is now set for ${when}.`,
      });
    } catch (err) {
      this.logger.error(
        'Failed to notify consultant of a client visit date change',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Tell the tenant's admins a visit's status moved — the other half of the
   * hand-off: admin plans it, consultant reports back. The actor never gets
   * their own notification. Best-effort, same as `notifyConsultant`.
   */
  private async notifyStatusChange(p: {
    clientId: string;
    actorId: string;
    visitId: string;
    visitNumber: string | null;
    consultantName: string | null;
    companyName: string;
    from: string;
    to: string;
  }) {
    try {
      const admins = await this.prisma.user.findMany({
        where: {
          clientId: p.clientId,
          isActive: true,
          userRoles: { some: { role: { name: 'Admin' } } },
          id: { not: p.actorId },
        },
        select: { id: true },
      });
      const label = p.visitNumber ? `${p.visitNumber} — ` : '';
      const to = VISIT_STATUS_LABELS[p.to] ?? p.to.toLowerCase();
      const from = VISIT_STATUS_LABELS[p.from] ?? p.from.toLowerCase();
      const asked = p.to === RESCHEDULE_REQUESTED;
      await this.notifications.notifyMany(admins.map((a) => a.id), {
        clientId: p.clientId,
        type: 'CLIENT_VISIT_UPDATED',
        link: `/client-visits/${p.visitId}/edit`,
        // A reschedule request is a job for an admin, not just news — say so.
        title: asked ? 'Client visit needs a new date' : `Client visit ${to}`,
        body: asked
          ? `${label}${p.companyName}: ${p.consultantName ?? 'the consultant'} asked to reschedule. Set a new date.`
          : `${label}${p.companyName}: ${p.consultantName ?? 'the consultant'} moved it from ${from} to ${to}.`,
      });
    } catch (err) {
      this.logger.error(
        'Failed to notify admins of client visit status change',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Non-admin staff only ever act on visits assigned to them, and only through
   * the report fields. Throws rather than silently narrowing, so a consultant
   * poking at another field gets a straight answer.
   */
  private assertConsultantScope(actor: VisitActor, visitConsultantId: string, dto: UpdateClientVisitDto) {
    if (isAdmin(actor)) return;
    if (visitConsultantId !== actor.id) {
      throw new ForbiddenException('This visit is not assigned to you');
    }
    // The validated DTO is a class instance, so every optional property exists
    // as `undefined` — only keys the caller actually sent count as an attempt.
    const blocked = Object.keys(dto).filter(
      (k) => dto[k as keyof UpdateClientVisitDto] !== undefined
        && !(CONSULTANT_EDITABLE as readonly string[]).includes(k),
    );
    if (blocked.length) {
      throw new ForbiddenException(`You can only update ${CONSULTANT_EDITABLE.join(', ')} on your visits`);
    }
  }

  /**
   * Where a visited record's visit count lands. A customer on per-product coverage
   * draws from the named product's own AMC/warranty pool (the one the Products
   * screen shows); everything else draws from the shared customer contract.
   * Returns the CustomerCompanyProduct id, or null for the shared pool.
   */
  private async resolvePool(customerCompanyId: string, productId: string | null | undefined) {
    if (!productId) return null;
    const company = await this.prisma.customerCompany.findUnique({
      where: { id: customerCompanyId },
      select: { contractScope: true },
    });
    if (company?.contractScope === 'CUSTOMER') return null; // one pool covers every product
    const cp = await this.prisma.customerCompanyProduct.findFirst({
      where: { customerCompanyId, productId },
      select: { id: true },
    });
    return cp?.id ?? null;
  }

  /**
   * Apply (sign 1) or reverse (sign -1) one visit against its pool.
   * Only the **visit count** moves: the hours recorded on a visit are deliberately
   * NOT charged to the product's / contract's support-hour balance — that balance
   * tracks ticket worklogs and explicitly logged usage only.
   */
  private async drawDown(customerCompanyId: string, cpId: string | null, sign: 1 | -1) {
    if (cpId) {
      await this.prisma.customerCompanyProduct.update({
        where: { id: cpId },
        data: { visitsUsed: { increment: sign } },
      });
      return;
    }
    await this.prisma.customerCompany.update({
      where: { id: customerCompanyId },
      data: { contractVisitsUsed: { increment: sign } },
    });
  }

  /**
   * A visit that hasn't happened yet cannot be booked into the past — PLANNED and
   * RESCHEDULE_REQUESTED both describe something still to come, so last month is never a
   * valid slot. VISITED is the opposite: it records what already happened, so
   * back-dating one is the normal case and stays allowed.
   */
  private assertScheduleDate(status: string, visitDate: Date) {
    if (status === DEDUCTING_STATUS) return;
    if (visitDate.getTime() < startOfToday().getTime()) {
      throw new BadRequestException(
        'A visit that has not happened yet cannot be scheduled in the past',
      );
    }
  }

  /**
   * Hours are the consultant's to report. An admin booking a visit cannot know
   * them yet, so `create` leaves them blank — but a consultant reporting back has
   * to state them, and a visit that actually took place cannot have taken zero
   * time. Asking to reschedule is the exception: nobody was on site.
   */
  private assertConsultantHours(
    actor: VisitActor,
    dto: UpdateClientVisitDto,
    status: string,
    existingHours: number,
  ) {
    if (isAdmin(actor)) return;
    const hours = dto.hours !== undefined ? Number(dto.hours) : existingHours;
    if (!Number.isFinite(hours) || hours < 0) {
      throw new BadRequestException('Enter the hours you spent on this visit');
    }
    if (status === DEDUCTING_STATUS && hours <= 0) {
      throw new BadRequestException('A visit that took place needs more than zero hours');
    }
  }

  async findAll(clientId: string, filters: { customerCompanyId?: string, consultantId?: string, productId?: string, ticketId?: string, status?: string, from?: string, to?: string }, actor: VisitActor) {
    const where: any = { clientId };
    // A consultant's list is their own visits, whatever they ask for.
    if (!isAdmin(actor)) where.consultantId = actor.id;
    if (filters.customerCompanyId) where.customerCompanyId = filters.customerCompanyId;
    if (filters.consultantId && isAdmin(actor)) where.consultantId = filters.consultantId;
    if (filters.productId) where.productId = filters.productId;
    if (filters.ticketId) where.ticketId = filters.ticketId;
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      where.visitDate = {};
      if (filters.from) where.visitDate.gte = new Date(filters.from);
      if (filters.to) where.visitDate.lte = new Date(filters.to);
    }

    return this.prisma.clientVisit.findMany({
      where,
      include: {
        customerCompany: {
          select: { name: true }
        }
      },
      orderBy: { visitDate: 'desc' }
    });
  }

  async findOne(clientId: string, id: string, actor: VisitActor) {
    const visit = await this.prisma.clientVisit.findFirst({
      where: { id, clientId },
      include: { customerCompany: { select: { name: true } } }
    });
    if (!visit) throw new NotFoundException('Client visit not found');
    // Hide someone else's visit behind the same 404 the list already implies.
    if (!isAdmin(actor) && visit.consultantId !== actor.id) {
      throw new NotFoundException('Client visit not found');
    }
    return visit;
  }

  async create(clientId: string, dto: CreateClientVisitDto, actorId: string) {
    const company = await this.assertCompany(clientId, dto.customerCompanyId);
    this.assertProductForScope(company, dto.productId);
    this.assertScheduleDate(dto.status, new Date(dto.visitDate));
    const consultantName = await this.consultantName(clientId, dto.consultantId);
    const productName = dto.productId
      ? await this.productName(clientId, dto.customerCompanyId, dto.productId)
      : null;

    const updatedClient = await this.prisma.client.update({
      where: { id: clientId },
      data: { clientVisitSequence: { increment: 1 } }
    });

    const visitNumber = `CL-${String(updatedClient.clientVisitSequence).padStart(6, '0')}`;
    const contractDeducted = dto.status === DEDUCTING_STATUS;
    const deductedCpId = contractDeducted
      ? await this.resolvePool(dto.customerCompanyId, dto.productId)
      : null;

    const visit = await this.prisma.clientVisit.create({
      data: {
        ...dto,
        clientId,
        consultantName,
        productName,
        visitNumber,
        contractDeducted,
        deductedCpId,
        visitDate: new Date(dto.visitDate),
        createdBy: actorId,
        updatedBy: actorId,
      }
    });

    if (contractDeducted) {
      await this.drawDown(dto.customerCompanyId, deductedCpId, 1);
    }

    await this.notifyConsultant({
      clientId,
      consultantId: visit.consultantId,
      actorId,
      visitId: visit.id,
      visitNumber: visit.visitNumber,
      visitDate: visit.visitDate,
      companyName: company.name,
      purpose: visit.purpose,
    });

    return visit;
  }

  async update(clientId: string, id: string, dto: UpdateClientVisitDto, actor: VisitActor) {
    const actorId = actor.id;
    const existingVisit = await this.prisma.clientVisit.findFirst({
      where: { id, clientId }
    });
    if (!existingVisit) throw new NotFoundException('Client visit not found');
    this.assertConsultantScope(actor, existingVisit.consultantId, dto);
    const company = dto.customerCompanyId
      ? await this.assertCompany(clientId, dto.customerCompanyId)
      : null;

    let consultantName = existingVisit.consultantName;
    if (dto.consultantId && dto.consultantId !== existingVisit.consultantId) {
      consultantName = await this.consultantName(clientId, dto.consultantId);
    }

    // The admin's half of a reschedule: the consultant declined the slot, the admin
    // supplies a new one. Saving the date it already had would hand the consultant
    // back the slot they just declined, so that is rejected outright.
    const newDate = dto.visitDate ? new Date(dto.visitDate) : existingVisit.visitDate;
    const dateChanged = !sameDay(newDate, existingVisit.visitDate);
    if (existingVisit.status === RESCHEDULE_REQUESTED && dto.visitDate && !dateChanged) {
      throw new BadRequestException(
        'This visit is being rescheduled — pick a date other than the one it already has',
      );
    }
    // Giving a rescheduled visit a new date puts it back on the calendar, so the
    // consultant sees an upcoming visit again rather than a stale request.
    //
    // The edit form posts the whole visit back, including the status it is already
    // on — so "no status in the payload" is NOT a reliable signal that the admin
    // left it alone, and keying off that left every form save stuck on
    // RESCHEDULE_REQUESTED. Only a deliberate move to a *different* status wins.
    const movedElsewhere = !!dto.status && dto.status !== RESCHEDULE_REQUESTED;
    const rescheduleConfirmed =
      existingVisit.status === RESCHEDULE_REQUESTED && dateChanged && !movedElsewhere;
    const newStatus = rescheduleConfirmed ? 'PLANNED' : dto.status || existingVisit.status;
    this.assertScheduleDate(newStatus, newDate);
    this.assertConsultantHours(actor, dto, newStatus, Number(existingVisit.hours ?? 0));
    const customerCompanyId = dto.customerCompanyId || existingVisit.customerCompanyId;
    const contractDeducted = newStatus === DEDUCTING_STATUS;

    // A product only stays on the visit while the (possibly new) customer owns it.
    const productId = dto.productId !== undefined ? dto.productId : existingVisit.productId;
    // Validate the shape the row is about to have, not just the fields that moved:
    // switching a visit onto a per-product client, or clearing its product, both
    // have to leave a row whose draw-down has somewhere to land.
    const effectiveCompany = company ?? (await this.assertCompany(clientId, customerCompanyId));
    this.assertProductForScope(effectiveCompany, productId);
    let productName = existingVisit.productName;
    if (!productId) {
      productName = null;
    } else if (productId !== existingVisit.productId || customerCompanyId !== existingVisit.customerCompanyId) {
      productName = await this.productName(clientId, customerCompanyId, productId);
    }

    // Reverse whatever this visit currently has applied, then apply its new shape.
    // Doing both (rather than only reacting to a status flip) keeps the pool
    // correct when the customer or product change on an already-VISITED row.
    if (existingVisit.contractDeducted) {
      await this.drawDown(existingVisit.customerCompanyId, existingVisit.deductedCpId, -1);
    }
    const deductedCpId = contractDeducted ? await this.resolvePool(customerCompanyId, productId) : null;
    if (contractDeducted) {
      await this.drawDown(customerCompanyId, deductedCpId, 1);
    }

    const data: any = {
      ...dto,
      consultantName,
      productName,
      contractDeducted,
      deductedCpId,
      // After the spread, so the automatic move back to PLANNED sticks.
      status: newStatus,
      // The status now says "planned"; this is what keeps the fact that it was
      // rescheduled, which is what the orange marker on the row reads.
      ...(rescheduleConfirmed ? { rescheduleCount: { increment: 1 } } : {}),
      updatedBy: actorId,
    };
    if (dto.visitDate) data.visitDate = newDate;

    const visit = await this.prisma.clientVisit.update({
      where: { id },
      data
    });

    // Only a hand-over rings the new consultant's bell; editing hours or status
    // on a visit they already own should not re-notify them.
    if (dto.consultantId && dto.consultantId !== existingVisit.consultantId) {
      await this.notifyConsultant({
        clientId,
        consultantId: visit.consultantId,
        actorId,
        visitId: visit.id,
        visitNumber: visit.visitNumber,
        visitDate: visit.visitDate,
        companyName: effectiveCompany.name,
        purpose: visit.purpose,
      });
    } else if (dateChanged) {
      // Same consultant, new slot — the hand-over branch above never fires for
      // this, which is why a rescheduled visit used to land silently.
      await this.notifyDateChange({
        clientId,
        consultantId: visit.consultantId,
        actorId,
        visitId: visit.id,
        visitNumber: visit.visitNumber,
        visitDate: visit.visitDate,
        companyName: effectiveCompany.name,
        wasRescheduled: rescheduleConfirmed,
      });
    }

    // The consultant reporting back — tell the admins who planned it.
    if (newStatus !== existingVisit.status) {
      await this.notifyStatusChange({
        clientId,
        actorId,
        visitId: visit.id,
        visitNumber: visit.visitNumber,
        consultantName: visit.consultantName,
        companyName: effectiveCompany.name,
        from: existingVisit.status,
        to: newStatus,
      });
    }

    return visit;
  }

  async remove(clientId: string, id: string) {
    const existingVisit = await this.prisma.clientVisit.findFirst({
      where: { id, clientId }
    });
    if (!existingVisit) throw new NotFoundException('Client visit not found');

    if (existingVisit.contractDeducted) {
      await this.drawDown(existingVisit.customerCompanyId, existingVisit.deductedCpId, -1);
    }

    return this.prisma.clientVisit.delete({
      where: { id }
    });
  }
}
