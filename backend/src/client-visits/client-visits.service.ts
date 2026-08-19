import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientVisitDto, UpdateClientVisitDto } from './dto/client-visit.dto';

/** The one status that books a visit against the customer's contract pool. */
const DEDUCTING_STATUS = 'VISITED';

@Injectable()
export class ClientVisitsService {
  constructor(private prisma: PrismaService) {}

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

  /** Guard the customer company against the tenant before any contract draw-down. */
  private async assertCompany(clientId: string, customerCompanyId: string) {
    const company = await this.prisma.customerCompany.findFirst({
      where: { id: customerCompanyId, clientId },
      select: { id: true },
    });
    if (!company) throw new BadRequestException('Customer company not found');
  }

  /**
   * Where a visited record's hours land. A customer on per-product coverage
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

  /** Apply (sign 1) or reverse (sign -1) one visit's hours + visit count against its pool. */
  private async drawDown(customerCompanyId: string, cpId: string | null, hours: number, sign: 1 | -1) {
    const data = { hours: (Number(hours) || 0) * sign, visits: sign };
    if (cpId) {
      await this.prisma.customerCompanyProduct.update({
        where: { id: cpId },
        data: { hoursUsed: { increment: data.hours }, visitsUsed: { increment: data.visits } },
      });
      return;
    }
    await this.prisma.customerCompany.update({
      where: { id: customerCompanyId },
      data: { contractHoursUsed: { increment: data.hours }, contractVisitsUsed: { increment: data.visits } },
    });
  }

  async findAll(clientId: string, filters: { customerCompanyId?: string, consultantId?: string, productId?: string, ticketId?: string, status?: string, from?: string, to?: string }) {
    const where: any = { clientId };
    if (filters.customerCompanyId) where.customerCompanyId = filters.customerCompanyId;
    if (filters.consultantId) where.consultantId = filters.consultantId;
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

  async findOne(clientId: string, id: string) {
    const visit = await this.prisma.clientVisit.findFirst({
      where: { id, clientId },
      include: { customerCompany: { select: { name: true } } }
    });
    if (!visit) throw new NotFoundException('Client visit not found');
    return visit;
  }

  async create(clientId: string, dto: CreateClientVisitDto, actorId: string) {
    await this.assertCompany(clientId, dto.customerCompanyId);
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
      await this.drawDown(dto.customerCompanyId, deductedCpId, dto.hours || 0, 1);
    }

    return visit;
  }

  async update(clientId: string, id: string, dto: UpdateClientVisitDto, actorId: string) {
    const existingVisit = await this.prisma.clientVisit.findFirst({
      where: { id, clientId }
    });
    if (!existingVisit) throw new NotFoundException('Client visit not found');
    if (dto.customerCompanyId) await this.assertCompany(clientId, dto.customerCompanyId);

    let consultantName = existingVisit.consultantName;
    if (dto.consultantId && dto.consultantId !== existingVisit.consultantId) {
      consultantName = await this.consultantName(clientId, dto.consultantId);
    }

    const newStatus = dto.status || existingVisit.status;
    const newHours = dto.hours !== undefined ? dto.hours : Number(existingVisit.hours);
    const customerCompanyId = dto.customerCompanyId || existingVisit.customerCompanyId;
    const contractDeducted = newStatus === DEDUCTING_STATUS;

    // A product only stays on the visit while the (possibly new) customer owns it.
    const productId = dto.productId !== undefined ? dto.productId : existingVisit.productId;
    let productName = existingVisit.productName;
    if (!productId) {
      productName = null;
    } else if (productId !== existingVisit.productId || customerCompanyId !== existingVisit.customerCompanyId) {
      productName = await this.productName(clientId, customerCompanyId, productId);
    }

    // Reverse whatever this visit currently has applied, then apply its new shape.
    // Doing both (rather than only reacting to a status flip) keeps the pool
    // correct when the hours or the customer change on an already-VISITED row.
    if (existingVisit.contractDeducted) {
      await this.drawDown(existingVisit.customerCompanyId, existingVisit.deductedCpId, Number(existingVisit.hours), -1);
    }
    const deductedCpId = contractDeducted ? await this.resolvePool(customerCompanyId, productId) : null;
    if (contractDeducted) {
      await this.drawDown(customerCompanyId, deductedCpId, newHours || 0, 1);
    }

    const data: any = {
      ...dto,
      consultantName,
      productName,
      contractDeducted,
      deductedCpId,
      updatedBy: actorId,
    };
    if (dto.visitDate) data.visitDate = new Date(dto.visitDate);

    return this.prisma.clientVisit.update({
      where: { id },
      data
    });
  }

  async remove(clientId: string, id: string) {
    const existingVisit = await this.prisma.clientVisit.findFirst({
      where: { id, clientId }
    });
    if (!existingVisit) throw new NotFoundException('Client visit not found');

    if (existingVisit.contractDeducted) {
      await this.drawDown(existingVisit.customerCompanyId, existingVisit.deductedCpId, Number(existingVisit.hours), -1);
    }

    return this.prisma.clientVisit.delete({
      where: { id }
    });
  }
}
