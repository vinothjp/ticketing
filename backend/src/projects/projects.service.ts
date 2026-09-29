import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProjectDto, UpdateProjectDto,
  CreateProjectTaskDto, UpdateProjectTaskDto, UpdateTaskStatusDto,
  CreateMilestoneDto, UpdateMilestoneDto,
  CreateTaskCommentDto, AddWatcherDto, AddDependencyDto,
  CreateSprintDto, UpdateSprintDto, MoveToSprintDto,
  CreateResourceDto, UpdateResourceDto, CreateTimesheetDto, UpdateTimesheetDto,
} from './dto/project.dto';
import {
  exportSheet, importTemplate, readSheet, rowReader, asText, asDate, errorText,
} from '../lib/spreadsheet';
import type { ImportResult } from '../lib/spreadsheet';
import { RESOURCE_COLUMNS, RESOURCE_IMPORT_NOTES } from './resource-sheet';
import type { ResourceSheetRow } from './resource-sheet';
import { assertCostedMember } from './timesheet-member';
import { timesheetRates } from './timesheet-rate';
import { assertLoggableTask } from './timesheet-task';

type Actor = { id: string; username?: string; roles?: string[] };
const isAdmin = (a: Actor) => !!a.roles?.includes('Admin');

// Default stage-gate milestones seeded on every new project (Excel spec).
const DEFAULT_MILESTONES = [
  'Requirement Complete', 'Blueprint', 'Development', 'Testing',
  'Training', 'Go Live', 'Hypercare', 'Closure',
];

// A task's % complete is read off its status, never typed — so reopening a task takes its %
// (and every rollup above it) back down with it. Parents still roll up from their children.
const STATUS_COMPLETION: Record<string, number> = { TODO: 0, IN_PROGRESS: 50, REVIEW: 80, COMPLETED: 100 };
const completionFor = (status: string) => STATUS_COMPLETION[status] ?? 0;

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  // ---- Projects -----------------------------------------------------------

  async list(clientId: string, opts: { search?: string; status?: string }) {
    const where: Prisma.ProjectWhereInput = { clientId };
    if (opts.status) where.status = opts.status;
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { projectNumber: { contains: opts.search, mode: 'insensitive' } },
        { key: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { tasks: true, resources: true, tickets: true } },
        tasks: { select: { id: true, completionPct: true, parentTaskId: true } },
      },
    });
    return projects.map((p) => this.withListProgress(p));
  }

  /** Tenant-wide project analytics + RAG health + portfolio financials (executive dashboard). */
  async analytics(clientId: string) {
    const [projects, tasks, invoices, expenses, timesheets] = await Promise.all([
      this.prisma.project.findMany({ where: { clientId }, select: { id: true, name: true, budget: true } }),
      this.prisma.projectTask.findMany({
        where: { project: { clientId } },
        select: { status: true, priority: true, assigneeName: true, projectId: true, dueDate: true, completionPct: true },
      }),
      this.prisma.projectInvoice.findMany({ where: { project: { clientId } }, select: { amount: true, amountPaid: true, projectId: true } }),
      this.prisma.projectExpense.findMany({ where: { project: { clientId } }, select: { amount: true, projectId: true } }),
      // Only approved hours are cost — same rule as the per-project Financials tab.
      this.prisma.projectTimesheet.findMany({ where: { project: { clientId }, status: 'APPROVED' }, select: { hours: true, costRate: true, projectId: true } }),
    ]);
    const num = (d: unknown) => Number(d ?? 0);
    const cat = (s: string) => (s === 'COMPLETED' ? 'completed' : s === 'IN_PROGRESS' || s === 'REVIEW' ? 'inProgress' : 'yetToStart');
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const taskStatus = { completed: 0, inProgress: 0, yetToStart: 0, total: tasks.length };
    const byPriority: Record<string, number> = { URGENT: 0, HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
    const workload = new Map<string, number>();
    type Row = { id: string; name: string; completed: number; inProgress: number; yetToStart: number; total: number; overdue: number; revenue: number; cost: number };
    const rows = new Map<string, Row>();
    for (const p of projects) rows.set(p.id, { id: p.id, name: p.name, completed: 0, inProgress: 0, yetToStart: 0, total: 0, overdue: 0, revenue: 0, cost: 0 });

    for (const t of tasks) {
      const c = cat(t.status);
      taskStatus[c]++;
      byPriority[t.priority && byPriority[t.priority] !== undefined ? t.priority : 'NONE']++;
      if (t.status !== 'COMPLETED' && t.assigneeName) workload.set(t.assigneeName, (workload.get(t.assigneeName) ?? 0) + 1);
      const row = rows.get(t.projectId);
      if (row) {
        row[c]++; row.total++;
        if (t.status !== 'COMPLETED' && t.dueDate && new Date(t.dueDate) < today) row.overdue++;
      }
    }
    // Revenue + resource cost per project for the financial rollup. Hours cost at the
    // rate frozen on each row when it was logged, never at today's rate.
    for (const i of invoices) { const row = rows.get(i.projectId); if (row) row.revenue += num(i.amount); }
    for (const e of expenses) { const row = rows.get(e.projectId); if (row) row.cost += num(e.amount); }
    for (const t of timesheets) { const row = rows.get(t.projectId); if (row) row.cost += num(t.hours) * num(t.costRate); }

    const rag = (r: Row) => {
      if (r.overdue >= 3) return 'RED';
      if (r.overdue > 0) return 'AMBER';
      return 'GREEN';
    };
    const perProject = [...rows.values()].map((r) => ({
      ...r,
      progress: r.total ? Math.round((r.completed / r.total) * 100) : 0,
      grossProfit: r.revenue - r.cost,
      margin: r.revenue > 0 ? Math.round(((r.revenue - r.cost) / r.revenue) * 1000) / 10 : 0,
      rag: rag(r),
    })).sort((a, b) => b.total - a.total);

    const portfolio = perProject.reduce((s, p) => ({ revenue: s.revenue + p.revenue, cost: s.cost + p.cost }), { revenue: 0, cost: 0 });

    return {
      taskStatus,
      byPriority,
      userWorkload: [...workload.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      perProject,
      portfolio: { ...portfolio, grossProfit: portfolio.revenue - portfolio.cost, margin: portfolio.revenue > 0 ? Math.round(((portfolio.revenue - portfolio.cost) / portfolio.revenue) * 1000) / 10 : 0 },
    };
  }

  // Change-request statuses that count as "approved" (their budget increase applies to the baseline).
  private static readonly CR_APPROVED = new Set(['APPROVED', 'CUSTOMER_APPROVED']);
  // …and those still awaiting a decision (their increase is a pending, not-yet-applied ask).
  private static readonly CR_PENDING = new Set(['SUBMITTED', 'PENDING_CUSTOMER']);

  /**
   * Shared financial math used by both the Financials dashboard and the Change-Request budget
   * check: actual cost (timesheets + expenses), revenue, per-user rates, and the budget model
   * (baseline = Project.budget, revised = baseline + Σ approved change requests).
   */
  private async financialCore(projectId: string) {
    const [project, invoices, expenses, timesheets, changeRequests] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { budget: true, currency: true } }),
      this.prisma.projectInvoice.findMany({ where: { projectId } }),
      this.prisma.projectExpense.findMany({ where: { projectId } }),
      // Hours become cost only once an Admin approves them; drafts and pending submissions don't count.
      this.prisma.projectTimesheet.findMany({ where: { projectId, status: 'APPROVED' } }),
      this.prisma.projectChangeRequest.findMany({ where: { projectId } }),
    ]);
    const num = (d: unknown) => Number(d ?? 0);

    const revenue = invoices.reduce((s, i) => s + num(i.amount), 0);
    const collected = invoices.reduce((s, i) => s + num(i.amountPaid), 0);
    const expenseCost = expenses.reduce((s, e) => s + num(e.amount), 0);

    let resourceCost = 0;
    const activityMap = new Map<string, { activity: string; hours: number; cost: number; revenue: number }>();
    for (const t of timesheets) {
      const hrs = num(t.hours);
      // The rates frozen on the row when it was logged — a later rate edit, category
      // change or removal from Resources never reprices work already done.
      const cost = hrs * num(t.costRate);
      const rev = hrs * num(t.billingRate);
      resourceCost += cost;
      const act = t.activity || 'Unassigned';
      const a = activityMap.get(act) ?? { activity: act, hours: 0, cost: 0, revenue: 0 };
      a.hours += hrs; a.cost += cost; a.revenue += rev;
      activityMap.set(act, a);
    }
    const vendorCost = 0;
    const totalCost = resourceCost + expenseCost + vendorCost;

    // Budget model: baseline never changes; approved change requests revise it upward.
    const baseline = num(project?.budget);
    const approvedChanges = changeRequests.filter((c) => ProjectsService.CR_APPROVED.has(c.status)).reduce((s, c) => s + num(c.budgetImpact), 0);
    const pendingChanges = changeRequests.filter((c) => ProjectsService.CR_PENDING.has(c.status)).reduce((s, c) => s + num(c.budgetImpact), 0);
    const revisedBudget = baseline + approvedChanges;

    return {
      project, num, invoices, expenses, changeRequests,
      revenue, collected, expenseCost, resourceCost, vendorCost, totalCost, activityMap,
      baseline, approvedChanges, pendingChanges, revisedBudget, remaining: revisedBudget - totalCost,
    };
  }

  /** Per-project financial dashboard (Excel): revenue, cost, profit, margin, activity costing. */
  async financials(projectId: string, clientId: string) {
    await this.getOwned(projectId, clientId);
    const c = await this.financialCore(projectId);
    const { num, revenue, collected, expenseCost, resourceCost, vendorCost, totalCost } = c;
    const grossProfit = revenue - totalCost;
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    const expensesByCategory: Record<string, number> = {};
    for (const e of c.expenses) expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + num(e.amount);

    return {
      revenue, collected, outstanding: revenue - collected,
      resourceCost, expenseCost, vendorCost, totalCost,
      grossProfit, grossMargin: pct(grossProfit, revenue),
      // Budget: baseline (original) + approved change requests = revised. `budget`/`budgetRemaining`
      // keep the revised meaning for any older callers; the tab uses the explicit fields.
      budgetBaseline: c.baseline, approvedChanges: c.approvedChanges, pendingChanges: c.pendingChanges,
      revisedBudget: c.revisedBudget,
      budget: c.revisedBudget, budgetRemaining: c.remaining,
      expensesByCategory,
      activityCosting: [...c.activityMap.values()].map((a) => ({ ...a, margin: pct(a.revenue - a.cost, a.revenue) })).sort((x, y) => y.revenue - x.revenue),
    };
  }

  /**
   * Change-Request view: a CR charges the customer for a NEW feature they requested. Each row is
   * just its amount (money charged) + status + the WBS item it created on approval. Plus the
   * project budget summary (Revised = baseline + Σ approved CRs).
   */
  async changeRequests(projectId: string, clientId: string) {
    await this.getOwned(projectId, clientId);
    const c = await this.financialCore(projectId);
    // Titles of the WBS items each approved CR introduced (changeRequestId = cr.id).
    const created = await this.prisma.projectTask.findMany({
      where: { projectId, changeRequestId: { not: null } },
      select: { id: true, title: true, changeRequestId: true },
    });
    const createdByCr = new Map<string, { id: string; title: string }>();
    for (const t of created) if (t.changeRequestId) createdByCr.set(t.changeRequestId, { id: t.id, title: t.title });
    const { num } = c;

    const changeRequests = c.changeRequests
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((cr) => ({
        ...cr,
        amount: cr.budgetImpact != null ? num(cr.budgetImpact) : 0,
        budgetImpact: cr.budgetImpact != null ? num(cr.budgetImpact) : null,
        createdTask: createdByCr.get(cr.id) ?? null,
      }));

    return {
      budget: {
        baseline: c.baseline, approvedChanges: c.approvedChanges, pendingChanges: c.pendingChanges,
        revisedBudget: c.revisedBudget, totalCost: c.totalCost, remaining: c.remaining,
        currency: (c.project as any)?.currency ?? null,
      },
      changeRequests,
    };
  }

  /**
   * Approve / reject / submit a change request. Approving creates the new top-level WBS item the
   * customer's feature introduces (once — idempotent) and its amount revises the budget upward.
   */
  async decideChangeRequest(crId: string, status: string, clientId: string, actor: Actor) {
    const cr = await this.prisma.projectChangeRequest.findFirst({ where: { id: crId, project: { clientId } } });
    if (!cr) throw new NotFoundException('Change request not found');
    const decided = status === 'APPROVED' || status === 'REJECTED';
    await this.prisma.projectChangeRequest.update({
      where: { id: crId },
      data: { status, decidedAt: decided ? new Date() : null, updatedAt: new Date() },
    });
    if (status === 'APPROVED') {
      const existing = await this.prisma.projectTask.findFirst({ where: { projectId: cr.projectId, changeRequestId: crId }, select: { id: true } });
      if (!existing) {
        const project = await this.prisma.project.findUnique({ where: { id: cr.projectId }, select: { startDate: true, endDate: true } });
        const roots = await this.prisma.projectTask.findMany({ where: { projectId: cr.projectId, parentTaskId: null }, select: { sortOrder: true } });
        const sortOrder = roots.length ? Math.max(...roots.map((r) => r.sortOrder ?? 0)) + 1 : 0;
        const seq = await this.prisma.project.update({ where: { id: cr.projectId }, data: { taskSequence: { increment: 1 } }, select: { taskSequence: true } });
        await this.prisma.projectTask.create({
          data: {
            projectId: cr.projectId,
            taskNumber: seq.taskSequence,
            wbsType: 'TASK',
            type: 'TASK',
            title: cr.title,
            status: 'TODO',
            startDate: project?.startDate ?? null,
            dueDate: project?.endDate ?? null,
            changeRequestId: crId,
            sortOrder,
            createdBy: actor.id,
            createdByName: actor.username ?? null,
            updatedBy: actor.id,
          },
        });
      }
    }
    return { id: crId, status };
  }

  async findOne(id: string, clientId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, clientId },
      include: {
        milestones: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        sprints: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        resources: { include: { user: { select: { id: true, username: true } }, category: true }, orderBy: { createdAt: 'asc' } },
        timesheets: { include: { user: { select: { id: true, username: true } } }, orderBy: { date: 'desc' } },
        tasks: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            predecessors: { select: { predecessorId: true } }, // drives Gantt dependency arrows
            _count: { select: { subtasks: true, comments: true } },
          },
        },
        tickets: {
          select: { id: true, ticketNumber: true, subject: true, ticketStatus: true, priority: true },
          orderBy: { createdAt: 'desc' },
        },
        customerCompany: { select: { id: true, name: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return this.withWbs(project);
  }

  async create(dto: CreateProjectDto, clientId: string, actor: Actor) {
    const managerName = await this.userName(clientId, dto.managerUserId);
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id: clientId },
        data: { projectSequence: { increment: 1 } },
      });
      const projectNumber = `PRJ-${String(client.projectSequence).padStart(6, '0')}`;
      const project = await tx.project.create({
        data: {
          clientId,
          projectNumber,
          name: dto.name.trim(),
          key: dto.key?.trim() || null,
          description: dto.description?.trim() || null,
          status: dto.status ?? 'OPEN',
          priority: dto.priority || null,
          managerUserId: dto.managerUserId || null,
          managerName,
          customerCompanyId: dto.customerCompanyId || null,
          budget: dto.budget ?? null,
          currency: dto.currency?.trim() || null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          // A new project shows its Timesheet tab; Settings → "Show timesheet" turns it off.
          features: { timeTracking: true, ...(dto.features ?? {}) } as Prisma.InputJsonValue,
          createdBy: actor.id,
          createdByName: actor.username ?? null,
          updatedBy: actor.id,
        },
      });
      // If a template was chosen, scaffold its WBS blueprint (milestones + tasks);
      // otherwise seed the 8 default stage-gate milestones.
      const template = dto.projectTemplateId
        ? await tx.projectTemplate.findFirst({ where: { id: dto.projectTemplateId, clientId } })
        : null;

      if (template) {
        const bp = (template.blueprint ?? {}) as {
          milestones?: { name: string; tasks?: { title: string; wbsType?: string; durationDays?: number }[] }[];
        };
        // Roll task dates forward from the project start date using durations.
        let cursor = project.startDate ? new Date(project.startDate) : null;
        const milestones = bp.milestones ?? [];
        for (let mi = 0; mi < milestones.length; mi++) {
          const m = milestones[mi];
          const milestone = await tx.projectMilestone.create({
            data: { projectId: project.id, name: m.name, sortOrder: mi, createdBy: actor.id },
          });
          const tasks = m.tasks ?? [];
          let milestoneEnd: Date | null = null;
          for (let ti = 0; ti < tasks.length; ti++) {
            const t = tasks[ti];
            const dur = Math.max(1, t.durationDays ?? 1);
            const start = cursor ? new Date(cursor) : null;
            const due = cursor ? new Date(cursor.getTime() + dur * 86400000) : null;
            await tx.projectTask.create({
              data: {
                projectId: project.id,
                milestoneId: milestone.id,
                title: t.title,
                wbsType: t.wbsType ?? 'TASK',
                durationDays: dur,
                sortOrder: ti,
                startDate: start,
                dueDate: due,
                createdBy: actor.id,
              },
            });
            if (cursor && due) cursor = new Date(due);
            milestoneEnd = due;
          }
          if (milestoneEnd) {
            await tx.projectMilestone.update({ where: { id: milestone.id }, data: { targetDate: milestoneEnd } });
          }
        }
      } else {
        await tx.projectMilestone.createMany({
          data: DEFAULT_MILESTONES.map((name, i) => ({ projectId: project.id, name, sortOrder: i, createdBy: actor.id })),
        });
      }
      return project;
    });
  }

  async update(id: string, dto: UpdateProjectDto, clientId: string, actor: Actor) {
    const proj = await this.getOwned(id, clientId);
    const set = <T>(v: T | undefined) => v !== undefined;

    const data: Prisma.ProjectUpdateInput = { updatedBy: actor.id };
    if (set(dto.name)) data.name = dto.name!.trim();
    if (set(dto.key)) data.key = dto.key?.trim() || null;
    if (set(dto.description)) data.description = dto.description?.trim() || null;
    if (set(dto.status)) data.status = dto.status;
    if (set(dto.isActive)) {
      // A project is never deleted, like a ticket; deactivating it is the Admin's call.
      if (!isAdmin(actor)) throw new ForbiddenException('Only an Admin can activate or deactivate a project');
      data.isActive = dto.isActive;
    }
    if (set(dto.priority)) data.priority = dto.priority || null;
    if (set(dto.customerCompanyId)) {
      data.customerCompany = dto.customerCompanyId
        ? { connect: { id: dto.customerCompanyId } }
        : { disconnect: true };
    }
    if (set(dto.startDate)) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (set(dto.endDate)) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (set(dto.goLiveDate)) data.goLiveDate = dto.goLiveDate ? new Date(dto.goLiveDate) : null;
    if (set(dto.features)) data.features = dto.features as Prisma.InputJsonValue;
    if (set(dto.projectCode)) data.projectCode = dto.projectCode?.trim() || null;
    if (set(dto.projectSponsor)) data.projectSponsor = dto.projectSponsor?.trim() || null;
    if (set(dto.department)) data.department = dto.department?.trim() || null;
    if (set(dto.budget)) data.budget = dto.budget ?? null;
    if (set(dto.currency)) data.currency = dto.currency?.trim() || null;
    if (set(dto.projectType)) data.projectType = dto.projectType?.trim() || null;
    if (set(dto.objective)) data.objective = dto.objective?.trim() || null;
    if (set(dto.scope)) data.scope = dto.scope?.trim() || null;
    if (set(dto.outOfScope)) data.outOfScope = dto.outOfScope?.trim() || null;
    if (set(dto.successCriteria)) data.successCriteria = dto.successCriteria?.trim() || null;
    if (set(dto.managerUserId)) {
      data.managerUserId = dto.managerUserId || null;
      data.managerName = await this.userName(clientId, dto.managerUserId);
    }

    await this.prisma.project.update({ where: { id }, data });
    // If the project's start/end window changed, re-bound every WBS item into it
    // (expanding just widens the room; shrinking clamps out-of-range items to the edge).
    if (set(dto.startDate) || set(dto.endDate)) {
      const newStart = set(dto.startDate) ? (dto.startDate ? new Date(dto.startDate) : null) : proj.startDate;
      const newEnd = set(dto.endDate) ? (dto.endDate ? new Date(dto.endDate) : null) : proj.endDate;
      await this.clampTasksToWindow(id, newStart, newEnd);
    }
    return this.findOne(id, clientId);
  }


  // ---- Tasks --------------------------------------------------------------

  async listTasks(projectId: string, clientId: string) {
    await this.getOwned(projectId, clientId);
    return this.prisma.projectTask.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createTask(projectId: string, dto: CreateProjectTaskDto, clientId: string, actor: Actor) {
    await this.getOwned(projectId, clientId);
    if (!isAdmin(actor)) throw new ForbiddenException('Only admins can create WBS items');
    const assigneeName = await this.userName(clientId, dto.assigneeUserId);
    const status = dto.status ?? 'TODO';
    const completionPct = completionFor(status);
    return this.prisma.$transaction(async (tx) => {
      // Per-project sequential task number → key = project.key + '-' + taskNumber.
      const proj = await tx.project.update({
        where: { id: projectId },
        data: { taskSequence: { increment: 1 } },
      });
      // Position among siblings: an explicit sortOrder inserts at that index (shifting the
      // rest down); otherwise the new item is appended to the end (never the top).
      const siblings = await tx.projectTask.findMany({
        where: { projectId, parentTaskId: dto.parentTaskId || null },
        select: { id: true, sortOrder: true, dueDate: true },
        orderBy: { sortOrder: 'asc' },
      });
      let sortOrder: number;
      if (dto.sortOrder != null) {
        sortOrder = Math.max(0, Math.min(dto.sortOrder, siblings.length));
        for (const s of siblings) {
          if ((s.sortOrder ?? 0) >= sortOrder) await tx.projectTask.update({ where: { id: s.id }, data: { sortOrder: (s.sortOrder ?? 0) + 1 } });
        }
      } else {
        sortOrder = siblings.length ? Math.max(...siblings.map((s) => s.sortOrder ?? 0)) + 1 : 0;
      }
      // Chain the schedule: a new item with no explicit start begins the day after the
      // item that precedes it in WBS order ends (previous sibling's end + 1 day).
      let autoStart: Date | null = null;
      if (!dto.startDate) {
        const prev = siblings.filter((s) => (s.sortOrder ?? 0) < sortOrder).sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0))[0];
        if (prev?.dueDate) autoStart = new Date(new Date(prev.dueDate).getTime() + 86_400_000);
      }
      const effStart = dto.startDate ? new Date(dto.startDate) : autoStart;
      const effEnd = dto.dueDate
        ? new Date(dto.dueDate)
        : (effStart ? new Date(effStart.getTime() + (dto.durationDays ?? 2) * 86_400_000) : null);
      await this.assertDateWindow(tx, projectId, dto.parentTaskId || null, effStart, effEnd, clientId);
      if (dto.sprintId) await this.assertSprintOfProject(tx, dto.sprintId, projectId);
      // Only leaves sit in a sprint. Splitting a sprint item hands its sprint to the new child.
      const inherited = dto.parentTaskId ? await this.releaseParentSprint(tx, dto.parentTaskId) : null;
      return tx.projectTask.create({
        data: {
          projectId,
          taskNumber: proj.taskSequence,
          milestoneId: dto.milestoneId || null,
          sprintId: dto.sprintId || inherited || null,
          storyPoints: dto.storyPoints ?? null,
          wbsType: dto.wbsType ?? 'TASK',
          durationDays: dto.durationDays ?? null,
          completionPct,
          estimatedHours: dto.estimatedHours ?? null,
          actualHours: dto.actualHours ?? null,
          critical: dto.critical ?? false,
          type: dto.type ?? 'TASK',
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          assigneeUserId: dto.assigneeUserId || null,
          assigneeName,
          status,
          priority: dto.priority || null,
          parentTaskId: dto.parentTaskId || null,
          startDate: effStart,
          // Every item gets an End so nothing is ever blank: provided, else Start + duration
          // (default 2 days) — covers the detail-dialog quick "add sub-task" that posts no dates.
          dueDate: effEnd,
          plannedEffort: dto.plannedEffort ?? null,
          tags: dto.tags ?? [],
          sortOrder,
          completedAt: status === 'COMPLETED' ? new Date() : null,
          createdBy: actor.id,
          createdByName: actor.username ?? null,
          updatedBy: actor.id,
        },
      });
    });
  }

  // Agents may only edit tasks assigned to them; admins edit anything.
  private assertTaskEditable(task: { assigneeUserId: string | null }, actor: Actor) {
    if (!isAdmin(actor) && task.assigneeUserId !== actor.id) {
      throw new ForbiddenException('You can only edit tasks assigned to you');
    }
  }

  // Authoritative date-window guard: a child must stay inside its parent's window
  // (activity ⊂ sub-task ⊂ task ⊂ phase); a top-level item (phase) must stay inside the
  // project's start..end window. Throws a BadRequestException whose message the frontend
  // surfaces as the "not allowed" toast.
  private async assertDateWindow(
    db: Prisma.TransactionClient | PrismaService,
    projectId: string,
    parentTaskId: string | null,
    start: Date | null,
    end: Date | null,
    clientId: string,
  ) {
    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    if (start && end && start.getTime() > end.getTime()) {
      throw new BadRequestException('Start date must be on or before End date');
    }
    if (parentTaskId) {
      const p = await db.projectTask.findFirst({
        where: { id: parentTaskId, project: { clientId } },
        select: { title: true, startDate: true, dueDate: true },
      });
      if (p) {
        if (p.startDate && start && start.getTime() < new Date(p.startDate).getTime()) {
          throw new BadRequestException(`Start date can't be before its parent "${p.title}" starts (${fmt(new Date(p.startDate))})`);
        }
        if (p.dueDate && end && end.getTime() > new Date(p.dueDate).getTime()) {
          throw new BadRequestException(`End date can't be after its parent "${p.title}" ends (${fmt(new Date(p.dueDate))})`);
        }
      }
    } else {
      const proj = await db.project.findFirst({ where: { id: projectId, clientId }, select: { startDate: true, endDate: true } });
      if (proj?.startDate && start && start.getTime() < new Date(proj.startDate).getTime()) {
        throw new BadRequestException(`Start date can't be before the project starts (${fmt(new Date(proj.startDate))})`);
      }
      if (proj?.endDate && end && end.getTime() > new Date(proj.endDate).getTime()) {
        throw new BadRequestException(`End date can't be after the project ends (${fmt(new Date(proj.endDate))})`);
      }
    }
  }

  // Re-bound + clamp: after the project window changes, pull any WBS item whose dates now fall
  // outside [start, end] back to the nearest edge (items that already fit are left untouched).
  private async clampTasksToWindow(projectId: string, start: Date | null, end: Date | null) {
    if (!start && !end) return;
    const clamp = (d: Date | null): Date | null => {
      if (!d) return d;
      let x = d.getTime();
      if (start && x < start.getTime()) x = start.getTime();
      if (end && x > end.getTime()) x = end.getTime();
      return new Date(x);
    };
    const tasks = await this.prisma.projectTask.findMany({ where: { projectId }, select: { id: true, startDate: true, dueDate: true } });
    const updates = [];
    for (const t of tasks) {
      let s = clamp(t.startDate);
      let e = clamp(t.dueDate);
      if (s && e && s.getTime() > e.getTime()) s = e; // keep start ≤ end after clamping
      const changed = s?.getTime() !== t.startDate?.getTime() || e?.getTime() !== t.dueDate?.getTime();
      if (changed) updates.push(this.prisma.projectTask.update({ where: { id: t.id }, data: { startDate: s, dueDate: e } }));
    }
    if (updates.length) await this.prisma.$transaction(updates);
  }

  async updateTask(taskId: string, dto: UpdateProjectTaskDto, clientId: string, actor: Actor) {
    const existing = await this.getOwnedTask(taskId, clientId);
    this.assertTaskEditable(existing, actor);
    const set = <T>(v: T | undefined) => v !== undefined;

    const data: Prisma.ProjectTaskUpdateInput = { updatedBy: actor.id };
    if (set(dto.title)) data.title = dto.title!.trim();
    if (set(dto.type)) data.type = dto.type;
    if (set(dto.description)) data.description = dto.description?.trim() || null;
    if (set(dto.priority)) data.priority = dto.priority || null;
    if (set(dto.parentTaskId)) {
      data.parentTask = dto.parentTaskId
        ? { connect: { id: dto.parentTaskId } }
        : { disconnect: true };
    }
    if (set(dto.milestoneId)) {
      data.milestone = dto.milestoneId
        ? { connect: { id: dto.milestoneId } }
        : { disconnect: true };
    }
    if (set(dto.wbsType)) data.wbsType = dto.wbsType;
    if (set(dto.durationDays)) data.durationDays = dto.durationDays ?? null;
    if (set(dto.estimatedHours)) data.estimatedHours = dto.estimatedHours ?? null;
    if (set(dto.actualHours)) data.actualHours = dto.actualHours ?? null;
    if (set(dto.critical)) data.critical = dto.critical;
    if (set(dto.actualStart)) data.actualStart = dto.actualStart ? new Date(dto.actualStart) : null;
    if (set(dto.actualFinish)) data.actualFinish = dto.actualFinish ? new Date(dto.actualFinish) : null;
    if (set(dto.startDate)) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (set(dto.dueDate)) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    // Enforce the parent/project date window whenever the schedule changes.
    if (set(dto.startDate) || set(dto.dueDate)) {
      const s = set(dto.startDate) ? (dto.startDate ? new Date(dto.startDate) : null) : existing.startDate;
      const e = set(dto.dueDate) ? (dto.dueDate ? new Date(dto.dueDate) : null) : existing.dueDate;
      const parentId = set(dto.parentTaskId) ? (dto.parentTaskId || null) : existing.parentTaskId;
      await this.assertDateWindow(this.prisma, existing.projectId, parentId, s, e, clientId);
    }
    // When the schedule changes and no explicit duration was given, derive Duration (days)
    // = end − start and Est. hours = days × 9, so the edit dialog no longer shows 0 days.
    if ((set(dto.startDate) || set(dto.dueDate)) && !set(dto.durationDays)) {
      const effStart = set(dto.startDate) ? (dto.startDate ? new Date(dto.startDate) : null) : existing.startDate;
      const effEnd = set(dto.dueDate) ? (dto.dueDate ? new Date(dto.dueDate) : null) : existing.dueDate;
      if (effStart && effEnd) {
        const d = Math.max(0, Math.round((effEnd.getTime() - effStart.getTime()) / 86_400_000));
        data.durationDays = d;
        if (!set(dto.estimatedHours)) data.estimatedHours = d * 9;
      }
    }
    if (set(dto.plannedEffort)) data.plannedEffort = dto.plannedEffort ?? null;
    if (set(dto.tags)) data.tags = (dto.tags ?? []).map((t) => t.trim()).filter(Boolean);
    if (set(dto.storyPoints)) data.storyPoints = dto.storyPoints ?? null;
    if (set(dto.sprintId) && dto.sprintId) {
      // Sprints hold leaf work only — a summary item's sprints are derived from its leaves.
      if (await this.prisma.projectTask.count({ where: { parentTaskId: taskId } })) {
        throw new BadRequestException("A summary item can't be in a sprint — add the tasks beneath it instead");
      }
      await this.assertSprintOfProject(this.prisma, dto.sprintId, existing.projectId);
    }
    if (set(dto.sprintId)) {
      data.sprint = dto.sprintId ? { connect: { id: dto.sprintId } } : { disconnect: true };
    }
    if (set(dto.sortOrder)) data.sortOrder = dto.sortOrder;
    if (set(dto.assigneeUserId)) {
      data.assigneeUserId = dto.assigneeUserId || null;
      data.assigneeName = await this.userName(clientId, dto.assigneeUserId);
    }
    if (set(dto.status)) {
      data.status = dto.status;
      data.completedAt = dto.status === 'COMPLETED' ? (existing.completedAt ?? new Date()) : null;
      data.completionPct = completionFor(dto.status!);
    }

    // Re-parenting under a sprint item makes that item a summary: its sprint passes to this one.
    if (set(dto.parentTaskId) && dto.parentTaskId && dto.parentTaskId !== existing.parentTaskId) {
      const inherited = await this.releaseParentSprint(this.prisma, dto.parentTaskId);
      const ownSprint = set(dto.sprintId) ? dto.sprintId : existing.sprintId;
      if (inherited && !ownSprint) data.sprint = { connect: { id: inherited } };
    }
    const updated = await this.prisma.projectTask.update({ where: { id: taskId }, data });
    // Completing a parent completes everything beneath it (so the rollup reads 100%).
    if (dto.status === 'COMPLETED') await this.completeDescendants(existing.projectId, taskId, actor);
    // If the schedule moved, push dependent tasks forward (when cascading is enabled).
    if (set(dto.startDate) || set(dto.dueDate)) await this.cascadeDates(existing.projectId, taskId);
    return updated;
  }

  /**
   * WBS auto-scheduling: when a task's schedule grows, push the tasks that come after it
   * (its later siblings in WBS order, and — bubbling up — its ancestors' later siblings)
   * so nothing overlaps what precedes it. Each pushed task keeps its own duration, and its
   * whole subtree moves with it. Only shifts forward, never earlier. Parents summarise their
   * children, so they resize automatically (no stored parent dates involved).
   * Active by default; disable per-project with the `cascadingDates` feature set to false.
   */
  private async cascadeDates(projectId: string, rootId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { features: true } });
    const features = (project?.features ?? {}) as Record<string, any>;
    if (features.cascadingDates === false) return; // opt-out only

    const tasks = await this.prisma.projectTask.findMany({
      where: { projectId },
      select: { id: true, parentTaskId: true, sortOrder: true, createdAt: true, startDate: true, dueDate: true },
    });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const ROOT = '__root__';
    const childrenOf = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const k = t.parentTaskId ?? ROOT;
      (childrenOf.get(k) ?? childrenOf.set(k, []).get(k)!).push(t);
    }
    for (const arr of childrenOf.values()) {
      arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
    }

    // Pending shifts overlay the stored values while we compute.
    const shifts = new Map<string, { start: Date | null; due: Date | null }>();
    const curStart = (id: string) => (shifts.has(id) ? shifts.get(id)!.start : byId.get(id)?.startDate ?? null);
    const curDue = (id: string) => (shifts.has(id) ? shifts.get(id)!.due : byId.get(id)?.dueDate ?? null);
    // Effective span mirrors the display rollup: a node WITH children summarizes them
    // (its own stored dates are ignored); a leaf uses its own dates.
    const effEnd = (id: string): Date | null => {
      const kids = childrenOf.get(id) ?? [];
      if (kids.length) {
        let end: Date | null = null;
        for (const c of kids) { const ce = effEnd(c.id); if (ce && (!end || ce > end)) end = ce; }
        return end;
      }
      return curDue(id) ? new Date(curDue(id)!) : null;
    };
    const effStart = (id: string): Date | null => {
      const kids = childrenOf.get(id) ?? [];
      if (kids.length) {
        let start: Date | null = null;
        for (const c of kids) { const cs = effStart(c.id); if (cs && (!start || cs < start)) start = cs; }
        return start;
      }
      return curStart(id) ? new Date(curStart(id)!) : null;
    };
    const shiftSubtree = (id: string, deltaMs: number) => {
      const s = curStart(id);
      const d = curDue(id);
      shifts.set(id, {
        start: s ? new Date(new Date(s).getTime() + deltaMs) : null,
        due: d ? new Date(new Date(d).getTime() + deltaMs) : null,
      });
      for (const c of childrenOf.get(id) ?? []) shiftSubtree(c.id, deltaMs);
    };

    // Walk from the changed task up to the root; at each level push its later siblings.
    let nodeId: string | null = rootId;
    while (nodeId) {
      const node = byId.get(nodeId);
      if (!node) break;
      const siblings = childrenOf.get(node.parentTaskId ?? ROOT) ?? [];
      const idx = siblings.findIndex((s) => s.id === nodeId);
      let prevEnd = effEnd(nodeId);
      for (let i = idx + 1; i < siblings.length && prevEnd; i++) {
        const sib = siblings[i];
        const sibStart = effStart(sib.id); // rolled start, so phases (no own dates) still move
        if (sibStart && sibStart.getTime() < prevEnd.getTime()) {
          shiftSubtree(sib.id, prevEnd.getTime() - sibStart.getTime());
        }
        const se = effEnd(sib.id);
        if (se) prevEnd = se; // chain: this sibling's end gates the next
      }
      nodeId = node.parentTaskId;
    }

    for (const [id, v] of shifts) {
      await this.prisma.projectTask.update({ where: { id }, data: { startDate: v.start, dueDate: v.due } });
    }
  }

  async updateTaskStatus(taskId: string, dto: UpdateTaskStatusDto, clientId: string, actor: Actor) {
    const existing = await this.getOwnedTask(taskId, clientId);
    this.assertTaskEditable(existing, actor);
    const updated = await this.prisma.projectTask.update({
      where: { id: taskId },
      data: {
        status: dto.status,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        completedAt: dto.status === 'COMPLETED' ? (existing.completedAt ?? new Date()) : null,
        completionPct: completionFor(dto.status),
        updatedBy: actor.id,
      },
    });
    if (dto.status === 'COMPLETED') await this.completeDescendants(existing.projectId, taskId, actor);
    return updated;
  }

  /** Mark every descendant (sub-tasks at any depth) of a task COMPLETED / 100%. */
  private async completeDescendants(projectId: string, rootId: string, actor: Actor) {
    const all = await this.prisma.projectTask.findMany({
      where: { projectId },
      select: { id: true, parentTaskId: true },
    });
    const childrenBy = new Map<string, string[]>();
    for (const t of all) {
      if (!t.parentTaskId) continue;
      const arr = childrenBy.get(t.parentTaskId) ?? [];
      arr.push(t.id);
      childrenBy.set(t.parentTaskId, arr);
    }
    const descendants: string[] = [];
    const stack = [...(childrenBy.get(rootId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      descendants.push(id);
      const kids = childrenBy.get(id);
      if (kids) stack.push(...kids);
    }
    if (descendants.length) {
      await this.prisma.projectTask.updateMany({
        where: { id: { in: descendants } },
        data: { status: 'COMPLETED', completionPct: 100, completedAt: new Date(), updatedBy: actor.id },
      });
    }
  }

  async removeTask(taskId: string, clientId: string, actor: Actor) {
    const existing = await this.getOwnedTask(taskId, clientId);
    this.assertTaskEditable(existing, actor);
    await this.prisma.projectTask.delete({ where: { id: taskId } });
    return { message: 'Task deleted' };
  }

  /** Move a WBS item up or down among its siblings (renumbers the whole sibling group). */
  async moveTask(taskId: string, direction: 'up' | 'down', clientId: string, actor: Actor) {
    const task = await this.getOwnedTask(taskId, clientId);
    if (!isAdmin(actor)) throw new ForbiddenException('Only admins can reorder WBS items');
    const siblings = await this.prisma.projectTask.findMany({
      where: { projectId: task.projectId, parentTaskId: task.parentTaskId },
      select: { id: true },
      orderBy: [{ sortOrder: 'asc' }, { taskNumber: 'asc' }],
    });
    const order = siblings.map((s) => s.id);
    const idx = order.indexOf(taskId);
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= order.length) return { message: 'No change' };
    [order[idx], order[swap]] = [order[swap], order[idx]];
    // Normalize the whole sibling group to contiguous indices (handles legacy ties).
    await this.prisma.$transaction(order.map((id, i) => this.prisma.projectTask.update({ where: { id }, data: { sortOrder: i } })));
    return { message: 'Moved' };
  }

  // ---- Task detail (comments, watchers, sub-tasks, dependencies) ----------

  /** Full task with comments, watchers, sub-tasks, and predecessor/successor links. */
  async taskDetail(taskId: string, clientId: string) {
    const task = await this.prisma.projectTask.findFirst({
      where: { id: taskId, project: { clientId } },
      include: {
        comments: { orderBy: { createdAt: 'asc' } },
        watchers: { include: { user: { select: { id: true, username: true } } } },
        subtasks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        predecessors: { include: { predecessor: { select: { id: true, title: true, taskNumber: true, status: true } } } },
        successors: { include: { successor: { select: { id: true, title: true, taskNumber: true, status: true } } } },
        project: { select: { key: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async addComment(taskId: string, dto: CreateTaskCommentDto, clientId: string, actor: Actor) {
    await this.getOwnedTask(taskId, clientId);
    return this.prisma.projectTaskComment.create({
      data: { taskId, body: dto.body.trim(), authorUserId: actor.id, authorName: actor.username ?? null },
    });
  }

  async removeComment(commentId: string, clientId: string) {
    const comment = await this.prisma.projectTaskComment.findFirst({
      where: { id: commentId, task: { project: { clientId } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    await this.prisma.projectTaskComment.delete({ where: { id: commentId } });
    return { message: 'Comment deleted' };
  }

  async addWatcher(taskId: string, dto: AddWatcherDto, clientId: string) {
    await this.getOwnedTask(taskId, clientId);
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, clientId } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.projectTaskWatcher.upsert({
      where: { taskId_userId: { taskId, userId: dto.userId } },
      create: { taskId, userId: dto.userId },
      update: {},
      include: { user: { select: { id: true, username: true } } },
    });
  }

  async removeWatcher(taskId: string, userId: string, clientId: string) {
    await this.getOwnedTask(taskId, clientId);
    await this.prisma.projectTaskWatcher.deleteMany({ where: { taskId, userId } });
    return { message: 'Watcher removed' };
  }

  async addDependency(successorId: string, dto: AddDependencyDto, clientId: string) {
    if (successorId === dto.predecessorId) throw new BadRequestException('A task cannot depend on itself');
    const succ = await this.getOwnedTask(successorId, clientId);
    const pred = await this.getOwnedTask(dto.predecessorId, clientId);
    if (succ.projectId !== pred.projectId) throw new BadRequestException('Tasks must be in the same project');
    // Prevent a direct cycle (A→B and B→A).
    const reverse = await this.prisma.projectTaskDependency.findUnique({
      where: { predecessorId_successorId: { predecessorId: successorId, successorId: dto.predecessorId } },
    });
    if (reverse) throw new BadRequestException('That would create a circular dependency');
    return this.prisma.projectTaskDependency.upsert({
      where: { predecessorId_successorId: { predecessorId: dto.predecessorId, successorId } },
      create: { predecessorId: dto.predecessorId, successorId },
      update: {},
    });
  }

  async removeDependency(depId: string, clientId: string) {
    const dep = await this.prisma.projectTaskDependency.findFirst({
      where: { id: depId, successor: { project: { clientId } } },
    });
    if (!dep) throw new NotFoundException('Dependency not found');
    await this.prisma.projectTaskDependency.delete({ where: { id: depId } });
    return { message: 'Dependency removed' };
  }

  // ---- Sprints ------------------------------------------------------------

  async listSprints(projectId: string, clientId: string) {
    await this.getOwned(projectId, clientId);
    return this.prisma.projectSprint.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createSprint(projectId: string, dto: CreateSprintDto, clientId: string, actor: Actor) {
    await this.getOwned(projectId, clientId);
    return this.prisma.projectSprint.create({
      data: {
        projectId,
        name: dto.name.trim(),
        goal: dto.goal?.trim() || null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        createdBy: actor.id,
      },
    });
  }

  async updateSprint(sprintId: string, dto: UpdateSprintDto, clientId: string) {
    await this.getOwnedSprint(sprintId, clientId);
    const data: Prisma.ProjectSprintUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.goal !== undefined) data.goal = dto.goal?.trim() || null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.prisma.projectSprint.update({ where: { id: sprintId }, data });
  }

  async setSprintStatus(sprintId: string, status: 'ACTIVE' | 'COMPLETED', clientId: string) {
    await this.getOwnedSprint(sprintId, clientId);
    return this.prisma.projectSprint.update({ where: { id: sprintId }, data: { status } });
  }

  async removeSprint(sprintId: string, clientId: string) {
    await this.getOwnedSprint(sprintId, clientId);
    // Tasks return to the backlog (sprintId nulled via ON DELETE SET NULL).
    await this.prisma.projectSprint.delete({ where: { id: sprintId } });
    return { message: 'Sprint deleted' };
  }

  /**
   * Sprint membership, Jira-style: only leaf work items sit in a sprint. Moving a leaf moves it;
   * moving a summary item is a shortcut that moves every leaf beneath it currently in
   * `fromSprintId` (null = the backlog) — the summary itself never stores a sprint.
   */
  async moveToSprint(taskId: string, dto: MoveToSprintDto, clientId: string, actor: Actor) {
    const task = await this.getOwnedTask(taskId, clientId);
    const to = dto.sprintId || null;
    const from = dto.fromSprintId || null;
    if (to) await this.assertSprintOfProject(this.prisma, to, task.projectId);
    const tasks = await this.prisma.projectTask.findMany({
      where: { projectId: task.projectId },
      select: { id: true, parentTaskId: true, sprintId: true, wbsType: true, assigneeUserId: true },
    });
    const kids = new Map<string, string[]>();
    for (const t of tasks) if (t.parentTaskId) (kids.get(t.parentTaskId) ?? kids.set(t.parentTaskId, []).get(t.parentTaskId)!).push(t.id);
    if (!kids.has(taskId)) {
      this.assertTaskEditable(task, actor);
      await this.prisma.projectTask.update({ where: { id: taskId }, data: { sprintId: to, updatedBy: actor.id } });
      return { moved: 1 };
    }
    if (!isAdmin(actor)) throw new ForbiddenException('Only admins can move a whole branch between sprints');
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const leaves: string[] = [];
    const walk = (id: string) => {
      const c = kids.get(id);
      if (c) { c.forEach(walk); return; }
      const t = byId.get(id)!;
      if (t.wbsType !== 'PHASE' && (t.sprintId ?? null) === from) leaves.push(id);
    };
    walk(taskId);
    if (leaves.length) {
      await this.prisma.projectTask.updateMany({ where: { id: { in: leaves } }, data: { sprintId: to, updatedBy: actor.id } });
    }
    return { moved: leaves.length };
  }

  // A sprint named on a task must belong to that task's project.
  private async assertSprintOfProject(db: Prisma.TransactionClient | PrismaService, sprintId: string, projectId: string) {
    const ok = await db.projectSprint.count({ where: { id: sprintId, projectId } });
    if (!ok) throw new BadRequestException('Sprint not found in this project');
  }

  // An item gaining a child becomes a summary and stops holding a sprint; returns the sprint it
  // held so the child can take it over (splitting sprint work keeps it in the sprint).
  private async releaseParentSprint(db: Prisma.TransactionClient | PrismaService, parentId: string): Promise<string | null> {
    const parent = await db.projectTask.findUnique({ where: { id: parentId }, select: { sprintId: true } });
    if (!parent?.sprintId) return null;
    await db.projectTask.update({ where: { id: parentId }, data: { sprintId: null } });
    return parent.sprintId;
  }

  private async getOwnedSprint(sprintId: string, clientId: string) {
    const sprint = await this.prisma.projectSprint.findFirst({
      where: { id: sprintId, project: { clientId } },
    });
    if (!sprint) throw new NotFoundException('Sprint not found');
    return sprint;
  }

  // ---- Milestones (grouping / stage gates) -------------------------------

  async listMilestones(projectId: string, clientId: string) {
    await this.getOwned(projectId, clientId);
    return this.prisma.projectMilestone.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createMilestone(projectId: string, dto: CreateMilestoneDto, clientId: string, actor: Actor) {
    await this.getOwned(projectId, clientId);
    return this.prisma.projectMilestone.create({
      data: {
        projectId,
        name: dto.name.trim(),
        status: dto.status ?? 'PENDING',
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        sortOrder: dto.sortOrder ?? 0,
        createdBy: actor.id,
      },
    });
  }

  async updateMilestone(milestoneId: string, dto: UpdateMilestoneDto, clientId: string) {
    await this.getOwnedMilestone(milestoneId, clientId);
    const data: Prisma.ProjectMilestoneUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.targetDate !== undefined) data.targetDate = dto.targetDate ? new Date(dto.targetDate) : null;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.approverName !== undefined) data.approverName = dto.approverName?.trim() || null;
    if (dto.approvalStatus !== undefined) {
      data.approvalStatus = dto.approvalStatus;
      data.decidedAt = dto.approvalStatus === 'PENDING' ? null : new Date();
    }
    return this.prisma.projectMilestone.update({ where: { id: milestoneId }, data });
  }

  async removeMilestone(milestoneId: string, clientId: string) {
    await this.getOwnedMilestone(milestoneId, clientId);
    // Tasks are kept (their milestoneId is nulled via ON DELETE SET NULL).
    await this.prisma.projectMilestone.delete({ where: { id: milestoneId } });
    return { message: 'Milestone deleted' };
  }

  // ---- Resources plan -----------------------------------------------------

  async addResource(projectId: string, dto: CreateResourceDto, clientId: string, actor: Actor) {
    const project = await this.getOwned(projectId, clientId);
    if (!dto.userId) throw new BadRequestException('Member is required');
    // The category carries the daily rate; a member without one plans and bills at 0.
    if (!dto.categoryId) throw new BadRequestException(`Category is required — it sets the member's daily cost and billing rate`);
    this.assertResourceWindow(project, dto.startDate, dto.endDate);
    return this.prisma.projectResource.create({
      data: {
        projectId,
        userId: dto.userId || null,
        consultantName: dto.consultantName?.trim() || null,
        categoryId: dto.categoryId || null,
        role: dto.role?.trim() || null,
        allocationPct: dto.allocationPct ?? 100,
        dailyHours: dto.dailyHours ?? 8,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        billable: dto.billable ?? true,
        createdBy: actor.id,
      },
      include: { user: { select: { id: true, username: true } }, category: true },
    });
  }

  async updateResource(resourceId: string, dto: UpdateResourceDto, clientId: string) {
    const existing = await this.getOwnedResource(resourceId, clientId);
    if (dto.userId !== undefined && !dto.userId) throw new BadRequestException('Member is required');
    if (dto.categoryId !== undefined && !dto.categoryId) {
      throw new BadRequestException(`Category is required — it sets the member's daily cost and billing rate`);
    }
    // Only a write that touches the dates is checked, so editing the role or rate of a
    // member planned before the project was re-dated is not refused for it.
    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      const project = await this.getOwned(existing.projectId, clientId);
      this.assertResourceWindow(
        project,
        dto.startDate !== undefined ? dto.startDate : existing.startDate,
        dto.endDate !== undefined ? dto.endDate : existing.endDate,
      );
    }
    return this.prisma.projectResource.update({
      where: { id: resourceId },
      data: {
        ...(dto.userId !== undefined ? { userId: dto.userId || null } : {}),
        ...(dto.consultantName !== undefined ? { consultantName: dto.consultantName?.trim() || null } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
        ...(dto.role !== undefined ? { role: dto.role?.trim() || null } : {}),
        ...(dto.allocationPct !== undefined ? { allocationPct: dto.allocationPct } : {}),
        ...(dto.dailyHours !== undefined ? { dailyHours: dto.dailyHours } : {}),
        ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : null } : {}),
        ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(dto.endDate) : null } : {}),
        ...(dto.billable !== undefined ? { billable: dto.billable } : {}),
      },
      include: { user: { select: { id: true, username: true } }, category: true },
    });
  }

  async removeResource(resourceId: string, clientId: string) {
    await this.getOwnedResource(resourceId, clientId);
    await this.prisma.projectResource.delete({ where: { id: resourceId } });
    return { message: 'Resource removed' };
  }

  /** The project's resource plan as a spreadsheet, ready to be edited and posted back. */
  async exportResources(projectId: string, clientId: string) {
    await this.getOwned(projectId, clientId);
    const rows = await this.prisma.projectResource.findMany({
      where: { projectId },
      include: { user: { select: { username: true, name: true, employeeId: true } }, category: true },
      orderBy: { createdAt: 'asc' },
    });
    return exportSheet('Resources', RESOURCE_COLUMNS, rows as unknown as ResourceSheetRow[]);
  }

  /** The blank template: the same columns, minus the ones an import cannot set. */
  resourceImportTemplate() {
    return importTemplate('Resources', RESOURCE_COLUMNS, RESOURCE_IMPORT_NOTES);
  }

  /**
   * Bulk add/update of a project's resource plan, matched on the consultant.
   *
   * Every row goes through the ordinary `addResource` / `updateResource`, so an
   * import is a fast way to type, not a second way in. Rows run **serially**:
   * two rows naming the same new consultant must see each other, which a
   * `Promise.all` would not. The consultant has to be a real staff user of the
   * tenant — a name that matches nobody is refused, not stored as free text,
   * or every typo would add a phantom member to the plan.
   */
  async importResources(projectId: string, clientId: string, actor: Actor, file?: Express.Multer.File): Promise<ImportResult> {
    const project = await this.getOwned(projectId, clientId);
    const records = readSheet(file);
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

    const column = (header: string) => RESOURCE_COLUMNS.find((c) => c.header === header)!;
    const [CONSULTANT, ROLE, CATEGORY, ALLOC, HOURS, START, END, BILLABLE] = [
      'Consultant', 'Role', 'Category', 'Allocation %', 'Daily hours', 'Start date', 'End date', 'Billable',
    ].map(column);

    const categories = await this.prisma.resourceCategory.findMany({ where: { clientId }, select: { id: true, name: true } });
    const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));

    const wholeNumber = (v: unknown, label: string, min: number, max?: number) => {
      const text = asText(v);
      if (!text) return undefined;
      const n = Number(text);
      if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
        throw new BadRequestException(`${label}: "${text}" must be a whole number ${max !== undefined ? `from ${min} to ${max}` : `of at least ${min}`}`);
      }
      return n;
    };

    for (const [i, record] of records.entries()) {
      const line = i + 2; // the header is row 1, so a sheet row is its index + 2
      try {
        const read = rowReader(record);
        const consultant = asText(read(CONSULTANT));
        // A trailing blank row is the normal shape of a hand-edited sheet, not an error.
        if (!consultant && !Object.values(record).some((v) => asText(v))) continue;
        if (!consultant) throw new BadRequestException('Consultant is required');

        // Username is unique; Employee ID is unique per tenant. Matching either
        // could still reach two people (one's username is another's employee ID),
        // so an ambiguous hit is refused and named rather than guessed.
        const users = await this.prisma.user.findMany({
          where: {
            clientId, customerCompanyId: null,
            OR: [{ username: { equals: consultant, mode: 'insensitive' } }, { employeeId: consultant }],
          },
          select: { id: true, username: true },
        });
        if (users.length === 0) throw new BadRequestException(`Consultant "${consultant}" is not a staff user`);
        if (users.length > 1) {
          throw new BadRequestException(`Consultant "${consultant}" matches ${users.map((u) => u.username).join(' and ')} — use the username`);
        }
        const user = users[0];

        // A blank cell on an update means "leave it alone", so only the columns
        // the sheet actually carries are sent.
        const dto: UpdateResourceDto = {};
        const role = asText(read(ROLE));
        if (role) dto.role = role;
        const category = asText(read(CATEGORY));
        if (category) {
          const id = categoryByName.get(category.toLowerCase());
          if (!id) throw new BadRequestException(`Category "${category}" is not on the Resource Costs screen`);
          dto.categoryId = id;
        }
        const alloc = wholeNumber(read(ALLOC), 'Allocation %', 0, 100);
        if (alloc !== undefined) dto.allocationPct = alloc;
        const hours = wholeNumber(read(HOURS), 'Daily hours', 1);
        if (hours !== undefined) dto.dailyHours = hours;
        const start = asDate(read(START), 'Start date');
        if (start) dto.startDate = start;
        const end = asDate(read(END), 'End date');
        if (end) dto.endDate = end;
        const billable = asText(read(BILLABLE)).toLowerCase();
        if (billable) {
          if (['yes', 'y', 'true', '1'].includes(billable)) dto.billable = true;
          else if (['no', 'n', 'false', '0'].includes(billable)) dto.billable = false;
          else throw new BadRequestException(`Billable: "${asText(read(BILLABLE))}" must be Yes or No`);
        }

        const existing = await this.prisma.projectResource.findMany({ where: { projectId, userId: user.id }, select: { id: true } });
        if (existing.length > 1) {
          throw new BadRequestException(`${user.username} is on this plan ${existing.length} times — edit those rows on the Resources tab`);
        }
        if (existing.length === 1) {
          await this.updateResource(existing[0].id, dto, clientId);
          result.updated += 1;
        } else {
          await this.addResource(projectId, {
            ...dto,
            userId: user.id,
            consultantName: user.username,
            // Same defaults the Add Member form opens with.
            startDate: dto.startDate ?? project.startDate?.toISOString().slice(0, 10),
            endDate: dto.endDate ?? project.endDate?.toISOString().slice(0, 10),
          }, clientId, actor);
          result.created += 1;
        }
      } catch (e) {
        result.skipped += 1;
        result.errors.push({ row: line, message: errorText(e) });
      }
    }

    return result;
  }

  /**
   * A member is planned inside the project's own window: never starting before the
   * project starts, never ending after it ends, and never ending before starting.
   * Compared as calendar days, so the stored midnight-UTC stamps can't tip a boundary.
   */
  private assertResourceWindow(
    project: { startDate: Date | null; endDate: Date | null },
    start?: string | Date | null,
    end?: string | Date | null,
  ) {
    const day = (v?: string | Date | null) => (v ? new Date(v).toISOString().slice(0, 10) : undefined);
    const [s, e, ps, pe] = [day(start), day(end), day(project.startDate), day(project.endDate)];
    if (s && ps && s < ps) throw new BadRequestException(`Start date cannot be before the project starts (${ps})`);
    if (e && pe && e > pe) throw new BadRequestException(`End date cannot be after the project ends (${pe})`);
    if (s && pe && s > pe) throw new BadRequestException(`Start date cannot be after the project ends (${pe})`);
    if (e && ps && e < ps) throw new BadRequestException(`End date cannot be before the project starts (${ps})`);
    if (s && e && e < s) throw new BadRequestException('End date cannot be before the start date');
  }

  private async getOwnedResource(id: string, clientId: string) {
    const r = await this.prisma.projectResource.findFirst({ where: { id, project: { clientId } } });
    if (!r) throw new NotFoundException('Resource not found');
    return r;
  }

  // ---- Timesheets ---------------------------------------------------------

  async addTimesheet(projectId: string, dto: CreateTimesheetDto, clientId: string, actor: Actor) {
    const project = await this.getOwned(projectId, clientId);
    this.assertTimesheetDate(project, dto.date);
    const userId = dto.userId || actor.id;
    await assertCostedMember(this.prisma, userId, [projectId]);
    // The hours go on one of the project's own leaf tasks; its title is stored as the activity.
    const task = await assertLoggableTask(this.prisma, projectId, dto.taskId);
    // One entry per consultant · task · day — the weekly Timesheet page keeps the
    // same rule. More hours on a day that already has an entry are added to it
    // (2h + 3h is one 5h entry) and its note gains the new one; it stays that
    // entry, with the rate it was first logged at.
    const day = new Date(`${dto.date.slice(0, 10)}T00:00:00.000Z`);
    const note = dto.workPerformed?.trim() || null;
    const sameCell = await this.prisma.projectTimesheet.findMany({
      where: { projectId, userId, taskId: task.id, date: day },
      orderBy: { createdAt: 'asc' },
    });
    if (sameCell.some((e) => e.status === 'APPROVED')) {
      throw new ConflictException(`${task.title} on ${dto.date.slice(0, 10)} is already approved for this consultant — an Admin has to reopen it before more hours go on it`);
    }
    if (sameCell.length) {
      const [keep, ...extra] = sameCell;
      const notes = [...new Set([...sameCell.map((e) => e.workPerformed), note].filter((n): n is string => !!n))];
      const [merged] = await this.prisma.$transaction([
        this.prisma.projectTimesheet.update({
          where: { id: keep.id },
          data: {
            hours: sameCell.reduce((t, e) => t + Number(e.hours), 0) + dto.hours,
            workPerformed: notes.join('; ') || null,
            status: 'SUBMITTED',                     // what a Log Time entry is
          },
          include: { user: { select: { id: true, username: true } } },
        }),
        ...(extra.length ? [this.prisma.projectTimesheet.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } })] : []),
      ]);
      return merged;
    }
    const rateOf = await timesheetRates(this.prisma, userId, [projectId]);
    return this.prisma.projectTimesheet.create({
      data: {
        projectId,
        userId,
        ...rateOf(projectId),
        consultantName: dto.consultantName?.trim() || null,
        date: day,
        taskId: task.id,
        activity: task.title,
        hours: dto.hours,
        workPerformed: note,
        createdBy: actor.id,
      },
      include: { user: { select: { id: true, username: true } } },
    });
  }

  async updateTimesheet(timesheetId: string, dto: UpdateTimesheetDto, clientId: string, actor: Actor) {
    const existing = await this.getOwnedTimesheet(timesheetId, clientId);
    // Approval is what turns hours into project cost, so only an Admin may grant it —
    // or take it back, else an agent could un-approve an entry and re-shape it.
    const touchesApproval = dto.status !== undefined && dto.status !== existing.status
      && (dto.status === 'APPROVED' || existing.status === 'APPROVED');
    if (touchesApproval && !isAdmin(actor)) throw new ForbiddenException('Only an Admin can approve a timesheet or change an approved one');
    // Only a re-dated entry is checked, so approving one logged before the project was re-dated still works.
    if (dto.date !== undefined) this.assertTimesheetDate(await this.getOwned(existing.projectId, clientId), dto.date);
    const retask = dto.taskId !== undefined ? await assertLoggableTask(this.prisma, existing.projectId, dto.taskId) : null;
    // Moving an entry to another day or task must not land it on a cell that already has one.
    if (dto.date !== undefined || retask) {
      const taken = await this.prisma.projectTimesheet.findFirst({
        where: {
          id: { not: timesheetId }, projectId: existing.projectId, userId: existing.userId,
          taskId: retask?.id ?? existing.taskId,
          date: dto.date !== undefined ? new Date(`${dto.date.slice(0, 10)}T00:00:00.000Z`) : existing.date,
        },
        select: { id: true },
      });
      if (taken) throw new ConflictException('That consultant already has an entry for this task on that day — add the hours to it instead');
    }
    return this.prisma.projectTimesheet.update({
      where: { id: timesheetId },
      data: {
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        ...(dto.hours !== undefined ? { hours: dto.hours } : {}),
        // A re-pointed entry takes its new task's title; the activity is never free text.
        ...(retask ? { taskId: retask.id, activity: retask.title } : {}),
        ...(dto.workPerformed !== undefined ? { workPerformed: dto.workPerformed?.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: { user: { select: { id: true, username: true } } },
    });
  }

  /**
   * Logged time is deleted by the consultant who logged it, the project's manager or an
   * Admin. Approved time is project cost, so only the manager or an Admin may remove it.
   */
  async removeTimesheet(timesheetId: string, clientId: string, actor: Actor) {
    const existing = await this.getOwnedTimesheet(timesheetId, clientId);
    const project = await this.getOwned(existing.projectId, clientId);
    const manages = isAdmin(actor) || project.managerUserId === actor.id;
    if (!manages && existing.userId !== actor.id) {
      throw new ForbiddenException('Only the consultant who logged this time, the project manager or an Admin can delete it');
    }
    if (!manages && existing.status === 'APPROVED') {
      throw new ForbiddenException('This time is approved — only the project manager or an Admin can delete it');
    }
    await this.prisma.projectTimesheet.delete({ where: { id: timesheetId } });
    return { message: 'Timesheet entry removed' };
  }

  /** Time is logged on a day the project runs — not before it starts, not after it ends. */
  private assertTimesheetDate(project: { startDate: Date | null; endDate: Date | null }, date: string | Date) {
    const day = (v: string | Date) => new Date(v).toISOString().slice(0, 10);
    const d = day(date);
    if (project.startDate && d < day(project.startDate)) throw new BadRequestException(`Date cannot be before the project starts (${day(project.startDate)})`);
    if (project.endDate && d > day(project.endDate)) throw new BadRequestException(`Date cannot be after the project ends (${day(project.endDate)})`);
  }

  private async getOwnedTimesheet(id: string, clientId: string) {
    const r = await this.prisma.projectTimesheet.findFirst({ where: { id, project: { clientId } } });
    if (!r) throw new NotFoundException('Timesheet entry not found');
    return r;
  }

  // ---- Ticket linking -----------------------------------------------------

  async linkTicket(projectId: string, ticketId: string, clientId: string) {
    await this.getOwned(projectId, clientId);
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, clientId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { projectId } });
    return { message: 'Ticket linked' };
  }

  async unlinkTicket(projectId: string, ticketId: string, clientId: string) {
    await this.getOwned(projectId, clientId);
    await this.prisma.ticket.updateMany({
      where: { id: ticketId, clientId, projectId },
      data: { projectId: null },
    });
    return { message: 'Ticket unlinked' };
  }

  // ---- Helpers ------------------------------------------------------------

  /** List-card progress: average completion of the LEAF tasks (parents only roll up). */
  private withListProgress<T extends { tasks?: { id: string; completionPct: number; parentTaskId: string | null }[] }>(project: T) {
    const tasks = project.tasks ?? [];
    const parentIds = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean));
    const leaves = tasks.filter((t) => !parentIds.has(t.id)); // a leaf is never any task's parent
    const progress = leaves.length ? Math.round(leaves.reduce((s, t) => s + (t.completionPct ?? 0), 0) / leaves.length) : 0;
    return { ...project, progress };
  }

  /**
   * Detail view: roll the WBS tree bottom-up so every parent reports its
   * children's summed duration, spanned dates, and duration-weighted % — and
   * each milestone reports the % of its top-level WBS nodes.
   */
  private withWbs<T extends {
    tasks?: any[];
    milestones?: any[];
  }>(project: T) {
    const tasks = project.tasks ?? [];
    const byId = new Map<string, any>(tasks.map((t) => [t.id, t]));
    const childrenOf = new Map<string, any[]>();
    for (const t of tasks) {
      if (t.parentTaskId) (childrenOf.get(t.parentTaskId) ?? childrenOf.set(t.parentTaskId, []).get(t.parentTaskId)!).push(t);
    }
    // Order siblings by sortOrder (tie-break on taskNumber) for stable numbering + display.
    const bySort = (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.taskNumber ?? 0) - (b.taskNumber ?? 0);
    for (const arr of childrenOf.values()) arr.sort(bySort);
    // Live WBS numbers (1, 1.1, 1.1.2 …) computed from the current tree — no stored codes.
    const codeById = new Map<string, string>();
    const numberNodes = (nodes: any[], prefix: string) => {
      nodes.forEach((n, i) => {
        const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
        codeById.set(n.id, code);
        numberNodes(childrenOf.get(n.id) ?? [], code);
      });
    };
    numberNodes(tasks.filter((t) => !t.parentTaskId).sort(bySort), '');
    type Roll = { durationDays: number; est: number; start: Date | null; end: Date | null; completionPct: number };
    const cache = new Map<string, Roll>();
    const roll = (t: any): Roll => {
      const hit = cache.get(t.id); if (hit) return hit;
      const kids = childrenOf.get(t.id) ?? [];
      let res: Roll;
      if (kids.length === 0) {
        res = {
          durationDays: t.durationDays ?? 0,
          est: t.estimatedHours ?? 0,
          start: t.startDate ? new Date(t.startDate) : null,
          end: t.dueDate ? new Date(t.dueDate) : null,
          completionPct: t.completionPct ?? 0,
        };
      } else {
        let dur = 0, est = 0, wsum = 0, wpct = 0;
        let start: Date | null = null, end: Date | null = null;
        for (const k of kids) {
          const r = roll(k);
          dur += r.durationDays;
          est += r.est;
          if (r.start && (!start || r.start < start)) start = r.start;
          if (r.end && (!end || r.end > end)) end = r.end;
          const w = r.durationDays || 1; wsum += w; wpct += w * r.completionPct;
        }
        res = { durationDays: dur, est, start, end, completionPct: wsum ? Math.round(wpct / wsum) : 0 };
      }
      cache.set(t.id, res);
      return res;
    };
    const tasksOut = tasks.map((t) => {
      const isParent = (childrenOf.get(t.id) ?? []).length > 0;
      const r = roll(t);
      return {
        ...t,
        wbsCode: codeById.get(t.id) ?? t.wbsCode ?? null,
        isParent,
        rolledDurationDays: isParent ? r.durationDays : (t.durationDays ?? 0),
        rolledEstimatedHours: isParent ? r.est : (t.estimatedHours ?? null),
        rolledStart: isParent ? r.start : t.startDate,
        rolledEnd: isParent ? r.end : t.dueDate,
        rolledCompletionPct: isParent ? r.completionPct : (t.completionPct ?? 0),
      };
    });
    // Milestone %: only the top-level WBS nodes of each milestone (avoid double counting).
    const milestonesOut = (project.milestones ?? []).map((m) => {
      const roots = tasksOut.filter(
        (t) => t.milestoneId === m.id && (!t.parentTaskId || byId.get(t.parentTaskId)?.milestoneId !== m.id),
      );
      let wsum = 0, wpct = 0;
      for (const t of roots) { const w = t.rolledDurationDays || 1; wsum += w; wpct += w * t.rolledCompletionPct; }
      return { ...m, progress: wsum ? Math.round(wpct / wsum) : 0, taskCount: roots.length };
    });
    const top = tasksOut.filter((t) => !t.parentTaskId);
    let pwsum = 0, pwpct = 0;
    for (const t of top) { const w = t.rolledDurationDays || 1; pwsum += w; pwpct += w * t.rolledCompletionPct; }
    const progress = pwsum ? Math.round(pwpct / pwsum) : 0;
    return { ...project, tasks: tasksOut, milestones: milestonesOut, progress };
  }

  private async userName(clientId: string, userId?: string) {
    if (!userId) return null;
    const u = await this.prisma.user.findFirst({ where: { id: userId, clientId }, select: { username: true } });
    return u?.username ?? null;
  }

  private async getOwned(id: string, clientId: string) {
    const project = await this.prisma.project.findFirst({ where: { id, clientId } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /**
   * Users of the customer company linked to this project (its admin + employees).
   * Used to pick customer-side attendees for a project meeting — only people who
   * belong to the company associated with the project are eligible.
   */
  async customerContacts(projectId: string, clientId: string) {
    const project = await this.getOwned(projectId, clientId);
    if (!project.customerCompanyId) return [];
    const users = await this.prisma.user.findMany({
      where: { customerCompanyId: project.customerCompanyId, isActive: true },
      include: { userRoles: { include: { role: true } } },
      orderBy: { username: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.userRoles.some((ur) => ur.role.name === 'CustomerAdmin') ? 'admin' : 'employee',
    }));
  }

  private async getOwnedTask(taskId: string, clientId: string) {
    const task = await this.prisma.projectTask.findFirst({
      where: { id: taskId, project: { clientId } },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private async getOwnedMilestone(milestoneId: string, clientId: string) {
    const m = await this.prisma.projectMilestone.findFirst({
      where: { id: milestoneId, project: { clientId } },
    });
    if (!m) throw new NotFoundException('Milestone not found');
    return m;
  }
}
