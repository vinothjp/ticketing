import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { SaveWeekDto, TIMESHEET_ACTIVITIES } from './dto/timesheet.dto';

type Actor = { id: string; username?: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

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

  private async projectOptions(clientId: string) {
    const rows = await this.prisma.project.findMany({
      where: { clientId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, projectNumber: true, customerCompany: { select: { name: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      projectNumber: p.projectNumber,
      customerName: p.customerCompany?.name ?? null,
    }));
  }

  /**
   * The weekly grid for one consultant: existing entries collapsed into
   * (project, activity) rows with a per-day hours map, plus the pick-lists and
   * the document header (number + date) the UI renders.
   */
  async getWeek(clientId: string, actor: Actor, weekStart: string, userId?: string) {
    const uid = userId || actor.id;
    const days = this.weekDays(weekStart);
    const gte = dayStart(days[0]);
    const lt = new Date(dayStart(days[6]).getTime() + DAY_MS);

    const entries = await this.prisma.projectTimesheet.findMany({
      where: { userId: uid, date: { gte, lt }, project: { clientId } },
      select: {
        projectId: true, activity: true, date: true, hours: true,
        workPerformed: true, status: true, documentNumber: true,
      },
    });

    // Collapse to one row per (project, activity).
    const rowMap = new Map<string, {
      projectId: string; activity: string; workPerformed: string | null;
      status: string; days: Record<string, number>;
    }>();
    let documentNumber: string | null = null;
    for (const e of entries) {
      const activity = e.activity ?? '';
      const key = `${e.projectId}||${activity}`;
      let row = rowMap.get(key);
      if (!row) {
        row = { projectId: e.projectId, activity, workPerformed: null, status: 'DRAFT', days: {} };
        rowMap.set(key, row);
      }
      row.days[iso(e.date)] = Number(e.hours);
      if (e.workPerformed) row.workPerformed = e.workPerformed;
      // Surface the "strongest" status so a partly-approved row reads as approved.
      if (statusRank(e.status) > statusRank(row.status)) row.status = e.status;
      if (e.documentNumber && !documentNumber) documentNumber = e.documentNumber;
    }

    const [projects, consultantName] = await Promise.all([
      this.projectOptions(clientId),
      this.username(uid),
    ]);

    return {
      weekStart: days[0],
      days,
      consultant: { id: uid, username: consultantName },
      documentNumber: documentNumber ?? this.makeDocNumber(days[0], uid),
      documentDate: days[0],
      activities: TIMESHEET_ACTIVITIES,
      projects,
      rows: [...rowMap.values()],
    };
  }

  /**
   * Replace the consultant's editable (non-approved) entries for the week with
   * the submitted grid. One row is written per non-zero day cell. Approved cells
   * are preserved and never overwritten.
   */
  async saveWeek(clientId: string, actor: Actor, dto: SaveWeekDto) {
    const uid = dto.userId || actor.id;
    const days = new Set(this.weekDays(dto.weekStart));
    const weekStart = this.weekDays(dto.weekStart)[0];
    const gte = dayStart(weekStart);
    const lt = new Date(dayStart([...days][days.size - 1]).getTime() + DAY_MS);
    const status = dto.submit ? 'SUBMITTED' : 'DRAFT';

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

    const [consultantName] = await Promise.all([this.username(uid)]);
    const documentNumber = dto.documentNumber?.trim() || this.makeDocNumber(weekStart, uid);
    const documentDate = dayStart(weekStart);

    // Approved cells to protect (so we skip re-creating a colliding cell).
    const approved = await this.prisma.projectTimesheet.findMany({
      where: { userId: uid, date: { gte, lt }, status: 'APPROVED', project: { clientId } },
      select: { projectId: true, activity: true, date: true },
    });
    const approvedKeys = new Set(approved.map((a) => `${a.projectId}||${a.activity ?? ''}||${iso(a.date)}`));

    const creates: {
      projectId: string; userId: string; consultantName: string | null; date: Date;
      activity: string; hours: number; workPerformed: string | null;
      status: string; documentNumber: string; documentDate: Date; createdBy: string;
    }[] = [];
    for (const row of dto.rows) {
      for (const [dayKey, rawHours] of Object.entries(row.days)) {
        if (!days.has(dayKey)) continue;                 // ignore cells outside the week
        const hours = Number(rawHours);
        if (!hours || hours <= 0) continue;              // skip blanks/zeros
        if (approvedKeys.has(`${row.projectId}||${row.activity}||${dayKey}`)) continue;
        creates.push({
          projectId: row.projectId,
          userId: uid,
          consultantName,
          date: dayStart(dayKey),
          activity: row.activity,
          hours,
          workPerformed: row.workPerformed?.trim() || null,
          status,
          documentNumber,
          documentDate,
          createdBy: actor.id,
        });
      }
    }

    await this.prisma.$transaction([
      this.prisma.projectTimesheet.deleteMany({
        where: { userId: uid, date: { gte, lt }, status: { not: 'APPROVED' }, project: { clientId } },
      }),
      ...(creates.length ? [this.prisma.projectTimesheet.createMany({ data: creates })] : []),
    ]);

    return this.getWeek(clientId, actor, weekStart, uid);
  }

  /**
   * Parse an uploaded timesheet spreadsheet into grid rows (Project / Activity /
   * Date / Hours / Work Performed). Nothing is saved — the client merges the
   * result into the grid and the user reviews before saving.
   */
  async importWeek(clientId: string, file?: Express.Multer.File) {
    if (!file?.buffer && !file?.path) throw new BadRequestException('No file uploaded');
    const wb = file.buffer
      ? XLSX.read(file.buffer, { type: 'buffer', cellDates: true })
      : XLSX.readFile(file.path, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new BadRequestException('Spreadsheet has no sheets');
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    const projects = await this.projectOptions(clientId);
    const byName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p]));
    const byNumber = new Map(projects.map((p) => [p.projectNumber.trim().toLowerCase(), p]));
    const activityMatch = (v: string) =>
      TIMESHEET_ACTIVITIES.find((a) => a.toLowerCase() === v.trim().toLowerCase()) ?? null;

    const rowMap = new Map<string, { projectId: string; activity: string; workPerformed: string | null; days: Record<string, number> }>();
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
      const activity = activityMatch(activityRaw);
      if (!project || !activity) { unmatched.push(projectRaw + (activityRaw ? ` / ${activityRaw}` : '')); continue; }

      const date = dateRaw instanceof Date ? dateRaw : dateRaw ? new Date(String(dateRaw)) : null;
      if (!date || isNaN(date.getTime())) continue;
      const dayKey = iso(date);

      const key = `${project.id}||${activity}`;
      let row = rowMap.get(key);
      if (!row) { row = { projectId: project.id, activity, workPerformed: null, days: {} }; rowMap.set(key, row); }
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
