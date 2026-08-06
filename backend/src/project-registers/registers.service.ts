import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Actor = { id: string };

// Config per register type: Prisma delegate + which body fields are allowed and how to coerce them.
const REGISTERS: Record<string, {
  model: string; str: string[]; dates: string[]; nums: string[]; json: string[]; order: string;
}> = {
  risks: { model: 'projectRisk', str: ['title', 'probability', 'impact', 'mitigation', 'ownerName', 'status'], dates: [], nums: [], json: [], order: 'createdAt' },
  issues: { model: 'projectIssue', str: ['title', 'priority', 'ownerName', 'resolution', 'status'], dates: ['targetDate'], nums: [], json: [], order: 'createdAt' },
  'change-requests': { model: 'projectChangeRequest', str: ['title', 'description', 'reason', 'scheduleImpact', 'requestedBy', 'status'], dates: ['decidedAt'], nums: ['budgetImpact'], json: [], order: 'createdAt' },
  meetings: { model: 'projectMeeting', str: ['title', 'attendees', 'notes'], dates: ['date'], nums: [], json: ['actionItems'], order: 'date' },
  documents: { model: 'projectDocument', str: ['docType', 'name', 'versionNumber', 'filePath'], dates: [], nums: [], json: [], order: 'uploadedAt' },
  expenses: { model: 'projectExpense', str: ['category', 'description'], dates: ['date'], nums: ['amount'], json: [], order: 'date' },
  invoices: { model: 'projectInvoice', str: ['invoiceNumber', 'type', 'status'], dates: ['invoiceDate'], nums: ['amount', 'amountPaid'], json: [], order: 'invoiceDate' },
};

@Injectable()
export class RegistersService {
  constructor(private prisma: PrismaService) {}

  private cfg(type: string) {
    const c = REGISTERS[type];
    if (!c) throw new BadRequestException('Unknown register type');
    return c;
  }
  private delegate(model: string): any {
    return (this.prisma as any)[model];
  }
  private buildData(type: string, body: Record<string, any>) {
    const c = this.cfg(type);
    const data: Record<string, any> = {};
    for (const f of c.str) if (body[f] !== undefined) data[f] = typeof body[f] === 'string' ? (body[f].trim() || null) : body[f];
    for (const d of c.dates) if (body[d] !== undefined) data[d] = body[d] ? new Date(body[d]) : null;
    // Omit empty numerics so column defaults apply (e.g. amount/amountPaid default 0);
    // setting null would violate non-nullable Decimal columns.
    for (const n of c.nums) if (body[n] !== undefined && body[n] !== '' && body[n] != null) data[n] = Number(body[n]);
    for (const j of c.json) if (body[j] !== undefined) data[j] = body[j];
    // Documents: accept a plain `url` and store it in filePath.
    if (type === 'documents' && body.url !== undefined) data.filePath = body.url?.trim() || null;
    return data;
  }

  async list(projectId: string, type: string, clientId: string) {
    const c = this.cfg(type);
    await this.owned(projectId, clientId);
    return this.delegate(c.model).findMany({ where: { projectId }, orderBy: { [c.order]: 'desc' } });
  }

  async create(projectId: string, type: string, body: Record<string, any>, clientId: string, actor: Actor) {
    const c = this.cfg(type);
    await this.owned(projectId, clientId);
    const data = this.buildData(type, body);
    if (!data.title && !data.name && !data.gate && !data.category && !data.invoiceNumber) {
      throw new BadRequestException('A title/name is required');
    }
    return this.delegate(c.model).create({
      data: { projectId, ...data, ...(type === 'documents' ? { uploadedBy: actor.id } : { createdBy: actor.id }) },
    });
  }

  async update(type: string, itemId: string, body: Record<string, any>, clientId: string) {
    const c = this.cfg(type);
    await this.ownedItem(c.model, itemId, clientId);
    return this.delegate(c.model).update({ where: { id: itemId }, data: this.buildData(type, body) });
  }

  async remove(type: string, itemId: string, clientId: string) {
    const c = this.cfg(type);
    await this.ownedItem(c.model, itemId, clientId);
    await this.delegate(c.model).delete({ where: { id: itemId } });
    return { message: 'Deleted' };
  }

  private async owned(projectId: string, clientId: string) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, clientId }, select: { id: true } });
    if (!p) throw new NotFoundException('Project not found');
  }
  private async ownedItem(model: string, itemId: string, clientId: string) {
    const item = await this.delegate(model).findFirst({ where: { id: itemId, project: { clientId } }, select: { id: true } });
    if (!item) throw new NotFoundException('Item not found');
  }
}
