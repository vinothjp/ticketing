import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Who is searching — same shape the ticket service scopes visibility with. */
export type SearchViewer = {
  id: string;
  roles: string[];
  customerCompanyId?: string | null;
};

/** One hit, already carrying the route the header dropdown navigates to. */
export type SearchHit = {
  type: 'ticket' | 'client' | 'product' | 'module' | 'employee' | 'project' | 'kb';
  id: string;
  title: string;
  subtitle: string | null;
  to: string;
};

const isAdmin = (v: SearchViewer) => v.roles.includes('Admin');
const isCustomerAdmin = (v: SearchViewer) => v.roles.includes('CustomerAdmin');
const isCustomerSide = (v: SearchViewer) =>
  v.roles.includes('Customer') || v.roles.includes('CustomerAdmin');
const isCustomerEmployee = (v: SearchViewer) => isCustomerSide(v) && !isCustomerAdmin(v);

/** Per-type cap, so one noisy match can't crowd the others out of the dropdown. */
const PER_TYPE = 5;

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  /**
   * Global header search over tickets, clients, products and product modules.
   * Every branch is scoped by `clientId`, and each type repeats the visibility
   * rule of the screen it links to — a customer-side user never sees another
   * company's tickets, and only an Admin gets product/module hits, since the
   * product editor those route to is Admin-only.
   */
  async search(q: string, clientId: string, viewer: SearchViewer): Promise<SearchHit[]> {
    const term = q.trim();
    if (term.length < 2) return [];
    const like: Prisma.StringFilter = { contains: term, mode: 'insensitive' };

    const staff = !isCustomerSide(viewer);
    const [tickets, companies, products, modules, employees, projects, kbArticles] = await Promise.all([
      this.tickets(term, like, clientId, viewer),
      staff ? this.companies(like, clientId) : [],
      isAdmin(viewer) ? this.products(like, clientId) : [],
      isAdmin(viewer) ? this.modules(like, clientId) : [],
      isAdmin(viewer) ? this.employees(like, clientId) : [],
      staff ? this.projects(like, clientId) : [],
      this.kbArticles(like, clientId, viewer),
    ]);
    return [...tickets, ...companies, ...products, ...modules, ...employees, ...projects, ...kbArticles];
  }

  private async tickets(
    term: string,
    like: Prisma.StringFilter,
    clientId: string,
    viewer: SearchViewer,
  ): Promise<SearchHit[]> {
    // Mirrors TicketsService.findAll — the same visibility rule, so search can
    // never surface a ticket the list screen would hide.
    const scope: Prisma.TicketWhereInput = isCustomerAdmin(viewer)
      ? { customerCompanyId: viewer.customerCompanyId ?? '__none__' }
      : isCustomerEmployee(viewer)
      ? { customerCompanyId: viewer.customerCompanyId ?? '__none__', requestorUserId: viewer.id }
      : isAdmin(viewer)
      ? { approvalStatus: { not: 'PENDING_CUSTOMER' } }
      : {
          approvalStatus: { in: ['NONE', 'APPROVED'] },
          OR: [
            { technicians: { some: { userId: viewer.id } } },
            { approvals: { some: { approverUserId: viewer.id } } },
            { tasks: { some: { assigneeUserId: viewer.id } } },
          ],
        };
    const rows = await this.prisma.ticket.findMany({
      where: {
        clientId,
        AND: [
          scope,
          // A bare number ("42") should find TKT-000042, so the digits are
          // matched against the number as well as the free text.
          { OR: [{ ticketNumber: like }, { subject: like }, { customerName: like }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: PER_TYPE,
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        ticketStatus: true,
        customerCompany: { select: { name: true } },
      },
    });
    return rows.map((t) => ({
      type: 'ticket' as const,
      id: t.id,
      title: `${t.ticketNumber} — ${t.subject}`,
      subtitle: [t.customerCompany?.name, t.ticketStatus].filter(Boolean).join(' · ') || null,
      to: `/tickets/${t.id}`,
    }));
  }

  private async companies(like: Prisma.StringFilter, clientId: string): Promise<SearchHit[]> {
    const rows = await this.prisma.customerCompany.findMany({
      where: { clientId, OR: [{ name: like }, { code: like }] },
      orderBy: { name: 'asc' },
      take: PER_TYPE,
      select: { id: true, name: true, code: true },
    });
    return rows.map((c) => ({
      type: 'client' as const,
      id: c.id,
      title: c.name,
      subtitle: c.code ?? null,
      to: `/admin/clients/${c.id}`,
    }));
  }

  private async products(like: Prisma.StringFilter, clientId: string): Promise<SearchHit[]> {
    const rows = await this.prisma.product.findMany({
      where: { clientId, OR: [{ name: like }, { code: like }] },
      orderBy: { name: 'asc' },
      take: PER_TYPE,
      select: { id: true, name: true, code: true },
    });
    return rows.map((p) => ({
      type: 'product' as const,
      id: p.id,
      title: p.name,
      subtitle: p.code,
      to: `/admin/products/${p.id}/edit`,
    }));
  }

  private async modules(like: Prisma.StringFilter, clientId: string): Promise<SearchHit[]> {
    // A module has no screen of its own — it is edited inside its product.
    const rows = await this.prisma.productModule.findMany({
      where: { name: like, product: { clientId } },
      orderBy: { name: 'asc' },
      take: PER_TYPE,
      select: { id: true, name: true, product: { select: { id: true, name: true } } },
    });
    return rows.map((m) => ({
      type: 'module' as const,
      id: m.id,
      title: m.name,
      subtitle: m.product.name,
      to: `/admin/products/${m.product.id}/edit`,
    }));
  }

  private async employees(like: Prisma.StringFilter, clientId: string): Promise<SearchHit[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        clientId,
        customerCompanyId: null,
        OR: [{ username: like }, { name: like }, { employeeId: like }, { email: like }],
      },
      orderBy: { username: 'asc' },
      take: PER_TYPE,
      select: { id: true, username: true, name: true, employeeId: true, department: true },
    });
    return rows.map((u) => ({
      type: 'employee' as const,
      id: u.id,
      title: u.name || u.username,
      subtitle: [u.employeeId, u.department].filter(Boolean).join(' · ') || null,
      to: `/admin/employees/${u.id}`,
    }));
  }

  private async projects(like: Prisma.StringFilter, clientId: string): Promise<SearchHit[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        clientId,
        OR: [{ name: like }, { projectNumber: like }, { projectCode: like }, { key: like }],
      },
      orderBy: { createdAt: 'desc' },
      take: PER_TYPE,
      select: { id: true, name: true, projectNumber: true, status: true },
    });
    return rows.map((p) => ({
      type: 'project' as const,
      id: p.id,
      title: `${p.projectNumber} — ${p.name}`,
      subtitle: p.status,
      to: `/projects/${p.id}`,
    }));
  }

  private async kbArticles(like: Prisma.StringFilter, clientId: string, viewer: SearchViewer): Promise<SearchHit[]> {
    const rows = await this.prisma.kbArticle.findMany({
      where: {
        clientId,
        status: 'PUBLISHED',
        ...(isCustomerSide(viewer) ? { audience: 'CUSTOMER' } : {}),
        OR: [{ title: like }, { subject: like }, { documentNumber: like }],
      },
      orderBy: { publishedDate: 'desc' },
      take: PER_TYPE,
      select: { id: true, title: true, documentNumber: true, category: true },
    });
    return rows.map((a) => ({
      type: 'kb' as const,
      id: a.id,
      title: a.title,
      subtitle: [a.documentNumber, a.category].filter(Boolean).join(' · ') || null,
      to: `/knowledge-base/${a.id}`,
    }));
  }
}
