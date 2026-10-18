import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/** A work item time can be logged against, as the timesheet screens list it. */
export type LoggableTask = { id: string; code: string; title: string; phase: string | null };

// Structure, not work: a phase or milestone only groups or marks the items that hold it.
const NOT_WORK = new Set(['PHASE', 'MILESTONE']);

/**
 * Each project's loggable work items, in WBS order: the leaf tasks and subtasks —
 * never a phase, a milestone or a summary item with children, the same rule that
 * keeps a summary item out of a sprint. `code` is the live WBS number, computed
 * exactly as `ProjectsService.withWbs` does (siblings by sortOrder, then
 * taskNumber), so the dropdown reads the same as the Tasks tab. `phase` is the
 * top-level item the task sits under, shown as a hint.
 */
export async function loggableTasks(prisma: PrismaService, projectIds: string[]) {
  const out = new Map<string, LoggableTask[]>(projectIds.map((id) => [id, []]));
  if (!projectIds.length) return out;
  const tasks = await prisma.projectTask.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, projectId: true, parentTaskId: true, wbsType: true, title: true, sortOrder: true, taskNumber: true },
  });
  type Row = (typeof tasks)[number];
  const kids = new Map<string, Row[]>();                   // `${projectId}|${parentId}` -> children
  for (const t of tasks) {
    const k = `${t.projectId}|${t.parentTaskId ?? ''}`;
    (kids.get(k) ?? kids.set(k, []).get(k)!).push(t);
  }
  const bySort = (a: Row, b: Row) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.taskNumber ?? 0) - (b.taskNumber ?? 0);
  const walk = (projectId: string, parentId: string, prefix: string, phase: string | null) => {
    (kids.get(`${projectId}|${parentId}`) ?? []).sort(bySort).forEach((t, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      const under = parentId ? phase : t.title;              // the top-level ancestor's title
      if (kids.get(`${projectId}|${t.id}`)?.length) walk(projectId, t.id, code, under);
      else if (!NOT_WORK.has(t.wbsType ?? '')) out.get(projectId)!.push({ id: t.id, code, title: t.title, phase: parentId ? phase : null });
    });
  };
  for (const id of projectIds) walk(id, '', '', null);
  return out;
}

/** The loggable work item `taskId` names on `projectId`, or a 400 saying why it can't take hours. */
export async function assertLoggableTask(prisma: PrismaService, projectId: string, taskId: string | undefined | null) {
  if (!taskId) throw new BadRequestException('Pick the task the hours went on');
  const task = (await loggableTasks(prisma, [projectId])).get(projectId)!.find((t) => t.id === taskId);
  if (!task) {
    throw new BadRequestException("Time is logged against one of this project's tasks or subtasks — not a phase, a milestone, or an item that has tasks under it");
  }
  return task;
}
