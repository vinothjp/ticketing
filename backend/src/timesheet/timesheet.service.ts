import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { SaveWeekDto } from './dto/timesheet.dto';
import { timesheetRates } from '../projects/timesheet-rate';
import { assertCostedMember, costedProjectIds } from '../projects/timesheet-member';
import { loggableTasks } from '../projects/timesheet-task';

type Actor = { id: string; username?: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

// A grid row is one project + one work item. Entries written before rows named a
// task carry only their activity text, so those are keyed by it instead.
const rowKey = (projectId: string, taskId: string | null | undefined, activity: string | null | undefined) =>
  `${projectId}||${taskId ? `t:${taskId}` : `a:${activity ?? ''}`}`;

// Normalise a yyyy-mm-dd string to a UTC-midnight Date (avoids TZ drift on the
// day boundary — timesheet cells are whole days, not instants).
const dayStart = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);

@Injectable()
export class TimesheetService {
  constructor(private prisma: PrismaService) {}

  /** The 7 ISO day keys (Mon→Sun) of the week beginning `weekStart`. */
  private weekDays(weekStart: string): string[] {
    const start = dayStart(weekStart);
    return Array.from({ length: 7 }, (_, i) => iso(new Date(start.getTime() + i * DAY_MS)));
  }

  private async username(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    return u?.username ?? null;
  }

  /**
   * The projects a consultant may log time on: those whose Resources tab holds them
   * with a cost category. `keep` adds projects the week already has entries on, so
   * an older row still renders its project instead of being wiped by the Select.
   * Each carries its loggable work items, which are the grid's Activity choices.
   */
  private async projectOptions(clientId: string, userId: string, keep: string[] = []) {
    const member = await costedProjectIds(this.prisma, userId);
    const rows = await this.prisma.project.findMany({
      where: { clientId, id: { in: [...new Set([...member, ...keep])] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, projectNumber: true, startDate: true, endDate: true, customerCompany: { select: { name: true } } },
    });
    const tasks = await loggableTasks(this.prisma, rows.map((p) => p.id));
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      projectNumber: p.projectNumber,
      customerName: p.customerCompany?.name ?? null,
      // The grid greys out the days a project doesn't run, as yyyy-mm-dd.
      startDate: p.startDate ? iso(p.startDate) : null,
      endDate: p.endDate ? iso(p.endDate) : null,
      tasks: tasks.get(p.id) ?? [],
    }));
  }

  /**
   * The weekly grid for one consultant: existing entries collapsed into
   * (project, work item) rows with a per-day hours map, plus the pick-lists and
   * the document header (number + date) the UI renders.
   */
  async getWeek(clientId: string, actor: Actor, weekStart: string, userId?: string) {
    const uid = userId || actor.id;
    const days = this.weekDays(weekStart);
    const gte = dayStart(days[0]);
    const lt = new Date(dayStart(days[6]).getTime() + DAY_MS);

    const entries = await this.prisma.projectTimesheet.findMany({
      where: { userId: uid, date: { gte, lt }, project: { clientId } },
      // A fixed order, so the note a row shows is the one `saveWeek` compares against.
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: {
        projectId: true, taskId: true, activity: true, date: true, hours: true,
        workPerformed: true, status: true, documentNumber: true,
      },
    });

    // Collapse to one row per (project, work item).
    const rowMap = new Map<string, {
      projectId: string; taskId: string | null; activity: string; workPerformed: string | null;
      status: string; days: Record<string, number>;
    }>();
    let documentNumber: string | null = null;
    for (const e of entries) {
      const activity = e.activity ?? '';
      const key = rowKey(e.projectId, e.taskId, activity);
      let row = rowMap.get(key);
      if (!row) {
        row = { projectId: e.projectId, taskId: e.taskId, activity, workPerformed: null, status: 'DRAFT', days: {} };
        rowMap.set(key, row);
      }
      // One entry per cell is the rule; summing keeps the figure honest if two ever meet.
      row.days[iso(e.date)] = (row.days[iso(e.date)] ?? 0) + Number(e.hours);
      if (e.workPerformed) row.workPerformed = e.workPerformed;
      // Surface the "strongest" status so a partly-approved row reads as approved.
      if (statusRank(e.status) > statusRank(row.status)) row.status = e.status;
      if (e.documentNumber && !documentNumber) documentNumber = e.documentNumber;
    }

    const [projects, consultantName] = await Promise.all([
      this.projectOptions(clientId, uid, entries.map((e) => e.projectId)),
      this.username(uid),
    ]);

    return {
      weekStart: days[0],
      days,
      consultant: { id: uid, username: consultantName },
      documentNumber: documentNumber ?? this.makeDocNumber(days[0], uid),
      documentDate: days[0],
      projects,
      rows: [...rowMap.values()],
    };
  }

  /**
   * Reconcile the consultant's week with the grid, one cell — project · work item ·
   * day — at a time. A cell holds at most one entry: grid rows naming the same task
   * are summed into it (8h + 4h is one 12h entry), and two entries already sharing a
   * cell are folded into the first. Only what changed is written: an unchanged cell
   * keeps its status, note and frozen rate; Save never sends a submitted entry back
   * to draft, and Save & Submit moves drafts forward. Approved cells are locked.
   */
  async saveWeek(clientId: string, actor: Actor, dto: SaveWeekDto) {
    const uid = dto.userId || actor.id;
    const days = new Set(this.weekDays(dto.weekStart));
    const weekStart = this.weekDays(dto.weekStart)[0];
    const gte = dayStart(weekStart);
    const lt = new Date(dayStart([...days][days.size - 1]).getTime() + DAY_MS);
    const submit = !!dto.submit;

    // Tenant safety: every referenced project must belong to the caller's client.
    const projectIds = [...new Set(dto.rows.map((r) => r.projectId))];
    if (projectIds.length) {
      const owned = await this.prisma.project.findMany({
        where: { id: { in: projectIds }, clientId }, select: { id: true },
      });
      if (owned.length !== projectIds.length) {
        throw new BadRequestException('One or more projects are not part of this tenant');
      }
    }

    // 1. The grid as one figure per cell: rows naming the same work item are one row.
    type Want = { projectId: string; taskId: string | null; activity: string | null; notes: string[]; days: Map<string, number> };
    const wanted = new Map<string, Want>();
    for (const r of dto.rows) {
      const rk = rowKey(r.projectId, r.taskId, r.activity);
      let w = wanted.get(rk);
      if (!w) { w = { projectId: r.projectId, taskId: r.taskId || null, activity: r.activity ?? null, notes: [], days: new Map() }; wanted.set(rk, w); }
      const note = r.workPerformed?.trim();
      if (note && !w.notes.includes(note)) w.notes.push(note);
      for (const [d, h] of Object.entries(r.days)) {
        const n = Number(h);
        if (days.has(d) && n > 0) w.days.set(d, (w.days.get(d) ?? 0) + n);
      }
    }

    // 2. What the week holds now, per cell — read in getWeek's order, so the note a
    //    row showed is known and an untouched one is left alone.
    const stored = await this.prisma.projectTimesheet.findMany({
      where: { userId: uid, date: { gte, lt }, project: { clientId } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, projectId: true, taskId: true, activity: true, date: true, hours: true, status: true, workPerformed: true },
    });
    type Stored = (typeof stored)[number];
    const cells = new Map<string, Stored[]>();
    const shownNote = new Map<string, string>();
    for (const e of stored) {
      const rk = rowKey(e.projectId, e.taskId, e.activity);
      const ck = `${rk}||${iso(e.date)}`;
      (cells.get(ck) ?? cells.set(ck, []).get(ck)!).push(e);
      if (e.workPerformed) shownNote.set(rk, e.workPerformed);
    }

    // 3. The plan: what to create, update and delete.
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const written: { rk: string; w: Want; day: string }[] = [];     // cells whose hours change or appear
    const creates: { w: Want; day: string; hours: number; note: string | null }[] = [];
    const updates: { id: string; data: Record<string, unknown> }[] = [];
    const deletes: string[] = [];
    const seen = new Set<string>();
    for (const [rk, w] of wanted) {
      const note = w.notes.join('; ') || null;
      const noteChanged = note !== (shownNote.get(rk) ?? null);
      for (const [day, hours] of w.days) {
        const ck = `${rk}||${day}`;
        seen.add(ck);
        const have = cells.get(ck) ?? [];
        if (have.some((e) => e.status === 'APPROVED')) continue;             // locked
        if (!have.length) { creates.push({ w, day, hours, note }); written.push({ rk, w, day }); continue; }
        const [keep, ...extra] = have;
        const current = have.reduce((t, e) => t + Number(e.hours), 0);
        const changed = !same(hours, current) || extra.length > 0;
        const data: Record<string, unknown> = {};
        if (changed) {
          data.hours = hours;
          // Editing moves a draft or a rejected entry per the button; a submitted one stays submitted.
          data.status = submit || keep.status === 'SUBMITTED' ? 'SUBMITTED' : 'DRAFT';
          if (!same(hours, current)) written.push({ rk, w, day });
        } else if (submit && keep.status === 'DRAFT') {
          data.status = 'SUBMITTED';
        }
        if (noteChanged) data.workPerformed = note;
        if (Object.keys(data).length) updates.push({ id: keep.id, data });
        deletes.push(...extra.map((e) => e.id));
      }
    }
    // A cell the grid no longer carries is gone — unless it is approved.
    for (const [ck, have] of cells) {
      if (!seen.has(ck)) deletes.push(...have.filter((e) => e.status !== 'APPROVED').map((e) => e.id));
    }

    // 4. The rules, for the hours being written. Existing entries left as they
    //    were are not re-judged, so an old row never blocks saving the rest.
    const writtenProjects = [...new Set(written.map((c) => c.w.projectId))];
    // Hours are costed at the consultant's rate on the project's Resources tab.
    await assertCostedMember(this.prisma, uid, writtenProjects);
    // The activity is one of the project's own leaf tasks, whose title is stored as
    // the label; a row naming no task is accepted only where the week already held
    // it under that text (entries from before rows named a task).
    const tasksOf = await loggableTasks(this.prisma, writtenProjects);
    const legacyKeys = new Set(stored.filter((e) => !e.taskId).map((e) => rowKey(e.projectId, null, e.activity)));
    const titleOf = new Map<string, string>();
    const bad = new Set<string>();
    for (const { rk, w } of written) {
      if (w.taskId) {
        const t = tasksOf.get(w.projectId)?.find((x) => x.id === w.taskId);
        if (t) titleOf.set(t.id, t.title); else bad.add(w.activity || w.taskId);
      } else if (!legacyKeys.has(rk)) {
        bad.add(w.activity || '(no task)');
      }
    }
    if (bad.size) {
      throw new BadRequestException(
        `Every row needs one of its project's tasks or subtasks as its activity — not a phase or milestone: ${[...bad].join(', ')}`,
      );
    }
    // Time is logged on a day the project runs — the window Log Time enforces too.
    const windows = new Map((await this.prisma.project.findMany({
      where: { id: { in: writtenProjects }, clientId },
      select: { id: true, name: true, startDate: true, endDate: true },
    })).map((p) => [p.id, p]));
    const outside = new Map<string, string[]>();
    for (const { w, day } of written) {
      const p = windows.get(w.projectId);
      const [a, b] = [p?.startDate && iso(p.startDate), p?.endDate && iso(p.endDate)];
      if ((a && day < a) || (b && day > b)) outside.set(w.projectId, [...(outside.get(w.projectId) ?? []), day]);
    }
    if (outside.size) {
      const lines = [...outside].map(([id, ds]) => {
        const p = windows.get(id);
        const run = `${p?.startDate ? iso(p.startDate) : '…'} to ${p?.endDate ? iso(p.endDate) : '…'}`;
        return `${p?.name} runs ${run}, so ${[...new Set(ds)].sort().join(', ')} can't take hours`;
      });
      throw new BadRequestException(`Time can only be logged while a project runs: ${lines.join('; ')}.`);
    }

    // 5. Write. A new entry takes today's rate; an updated one keeps its frozen rate.
    const [consultantName, currentRate] = await Promise.all([
      this.username(uid),
      timesheetRates(this.prisma, uid, [...new Set(creates.map((c) => c.w.projectId))]),
    ]);
    const documentNumber = dto.documentNumber?.trim() || this.makeDocNumber(weekStart, uid);
    const documentDate = dayStart(weekStart);
    await this.prisma.$transaction([
      ...(deletes.length ? [this.prisma.projectTimesheet.deleteMany({ where: { id: { in: deletes } } })] : []),
      ...updates.map((u) => this.prisma.projectTimesheet.update({ where: { id: u.id }, data: u.data })),
      ...(creates.length ? [this.prisma.projectTimesheet.createMany({
        data: creates.map(({ w, day, hours, note }) => ({
          projectId: w.projectId,
          userId: uid,
          ...currentRate(w.projectId),
          consultantName,
          date: dayStart(day),
          taskId: w.taskId,
          activity: w.taskId ? titleOf.get(w.taskId) ?? null : w.activity,
          hours,
          workPerformed: note,
          status: submit ? 'SUBMITTED' : 'DRAFT',
          documentNumber,
          documentDate,
          createdBy: actor.id,
        })),
      })] : []),
    ]);

    return this.getWeek(clientId, actor, weekStart, uid);
  }

  /**
   * Parse an uploaded timesheet spreadsheet into grid rows (Project / Activity /
   * Date / Hours / Work Performed). Activity names one of the project's work
   * items, by title or WBS code. Nothing is saved — the client merges the
   * result into the grid and the user reviews before saving.
   */
  async importWeek(clientId: string, userId: string, file?: Express.Multer.File) {
    if (!file?.buffer && !file?.path) throw new BadRequestException('No file uploaded');
    const wb = file.buffer
      ? XLSX.read(file.buffer, { type: 'buffer', cellDates: true })
      : XLSX.readFile(file.path, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new BadRequestException('Spreadsheet has no sheets');
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    // Only the consultant's own projects match; a row for any other lands in `unmatched`.
    const projects = await this.projectOptions(clientId, userId);
    const byName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p]));
    const byNumber = new Map(projects.map((p) => [p.projectNumber.trim().toLowerCase(), p]));
    const tasksOf = await loggableTasks(this.prisma, projects.map((p) => p.id));
    const taskMatch = (projectId: string, v: string) => {
      const want = v.trim().toLowerCase();
      return tasksOf.get(projectId)?.find((t) => t.title.trim().toLowerCase() === want || t.code === want) ?? null;
    };

    const rowMap = new Map<string, { projectId: string; taskId: string; activity: string; workPerformed: string | null; days: Record<string, number> }>();
    const unmatched: string[] = [];

    for (const r of json) {
      const get = (...keys: string[]) => {
        for (const k of Object.keys(r)) {
          if (keys.some((want) => k.trim().toLowerCase() === want)) return r[k];
        }
        return null;
      };
      const projectRaw = String(get('project name', 'project', 'project code') ?? '').trim();
      const activityRaw = String(get('activity', 'task') ?? '').trim();
      const hours = Number(get('hours worked', 'hours', 'hour') ?? 0);
      const dateRaw = get('document date', 'date', 'day');
      const work = get('work performed', 'description') as string | null;
      if (!projectRaw || !hours) continue;

      const project = byName.get(projectRaw.toLowerCase()) || byNumber.get(projectRaw.toLowerCase());
      const task = project ? taskMatch(project.id, activityRaw) : null;
      if (!project || !task) { unmatched.push(projectRaw + (activityRaw ? ` / ${activityRaw}` : '')); continue; }

      const date = dateRaw instanceof Date ? dateRaw : dateRaw ? new Date(String(dateRaw)) : null;
      if (!date || isNaN(date.getTime())) continue;
      const dayKey = iso(date);

      const key = rowKey(project.id, task.id, null);
      let row = rowMap.get(key);
      if (!row) { row = { projectId: project.id, taskId: task.id, activity: task.title, workPerformed: null, days: {} }; rowMap.set(key, row); }
      row.days[dayKey] = (row.days[dayKey] ?? 0) + hours;
      if (work) row.workPerformed = String(work);
    }

    return { rows: [...rowMap.values()], unmatched };
  }

  private makeDocNumber(weekStart: string, userId: string) {
    return `TS-${weekStart}-${userId.slice(0, 8)}`;
  }
}

// DRAFT < SUBMITTED < REJECTED < APPROVED (approval is the strongest signal).
function statusRank(s: string): number {
  return { DRAFT: 0, SUBMITTED: 1, REJECTED: 2, APPROVED: 3 }[s] ?? 0;
}
