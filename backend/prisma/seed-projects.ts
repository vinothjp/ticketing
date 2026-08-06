import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Standalone, idempotent sample data for the Project Management module (WBS model).
// Rebuilt on each run; only touches projects whose name starts with "[SAMPLE]".
//   docker exec ticketing-backend-1 npx ts-node prisma/seed-projects.ts

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SAMPLE = '[SAMPLE]';
const DAY = 86_400_000;
const now = new Date();
const day = (offset: number) => new Date(now.getTime() + offset * DAY);

const DEFAULT_MILESTONES = [
  'Requirement Complete', 'Blueprint', 'Development', 'Testing',
  'Training', 'Go Live', 'Hypercare', 'Closure',
];

type Status = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'COMPLETED';
type WbsType = 'PHASE' | 'TASK' | 'SUBTASK' | 'ACTIVITY' | 'MILESTONE';

// A WBS node. Leaf nodes carry duration/dates; parents roll up from children.
type Node = {
  key: string;
  title: string;
  wbsType: WbsType;
  milestone?: string;   // milestone name (grouping)
  assignee?: string;
  status?: Status;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  durationDays?: number;
  start?: number;       // day offset (leaf)
  completionPct?: number;
  dep?: string;         // predecessor node key
  critical?: boolean;
  children?: Node[];
};

type ProjSpec = {
  name: string;
  key: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  manager: string;
  start: number;
  end: number;
  members: { u: string; role?: 'MEMBER' | 'MANAGER' }[];
  wbs: Node[];
};

async function main() {
  const client = await prisma.client.findUnique({ where: { code: 'ACME' } });
  if (!client) throw new Error('Acme Corp client missing — run `npm run prisma:seed` first.');
  const clientId = client.id;

  const wanted = ['admin', 'agent1', 'agent2', 'agent3', 'agent4', 'agent5'];
  const users = await prisma.user.findMany({ where: { clientId, username: { in: wanted } }, select: { id: true, username: true } });
  const uid = (n: string) => users.find((u) => u.username === n)?.id ?? null;
  const uname = (n: string) => users.find((u) => u.username === n)?.username ?? n;
  const missing = wanted.filter((n) => !uid(n));
  if (missing.length) throw new Error(`Missing seed users: ${missing.join(', ')} — run the main seed first.`);

  await prisma.project.deleteMany({ where: { clientId, name: { startsWith: SAMPLE } } });

  // Tenant resource-cost catalog (idempotent).
  const CATS = [
    { name: 'Project Manager', hourlyCost: 220, billingRate: 400 },
    { name: 'Sr Developer', hourlyCost: 180, billingRate: 350 },
    { name: 'Jr Developer', hourlyCost: 90, billingRate: 200 },
    { name: 'QA Engineer', hourlyCost: 110, billingRate: 240 },
  ];
  const catByName: Record<string, string> = {};
  for (const c of CATS) {
    const row = await prisma.resourceCategory.upsert({
      where: { clientId_name: { clientId, name: c.name } },
      update: { hourlyCost: c.hourlyCost, billingRate: c.billingRate, dailyHours: 8 },
      create: { clientId, name: c.name, hourlyCost: c.hourlyCost, billingRate: c.billingRate, dailyHours: 8 },
    });
    catByName[c.name] = row.id;
  }

  const specs: ProjSpec[] = [
    {
      name: 'ERP Implementation', key: 'ERP', status: 'IN_PROGRESS', priority: 'HIGH',
      manager: 'agent1', start: -25, end: 60,
      members: [{ u: 'agent1', role: 'MANAGER' }, { u: 'agent2' }, { u: 'agent3' }, { u: 'agent4' }],
      wbs: [
        { key: 'p1', title: 'Requirement Gathering', wbsType: 'PHASE', milestone: 'Requirement Complete', children: [
          { key: 'p1t1', title: 'Business Meetings', wbsType: 'TASK', milestone: 'Requirement Complete', children: [
            { key: 'p1t1a', title: 'Stakeholder interviews', wbsType: 'SUBTASK', assignee: 'agent2', status: 'COMPLETED', completionPct: 100, durationDays: 2, start: -25 },
            { key: 'p1t1b', title: 'Process mapping', wbsType: 'SUBTASK', assignee: 'agent2', status: 'COMPLETED', completionPct: 100, durationDays: 3, start: -23, dep: 'p1t1a' },
          ]},
          { key: 'p1t2', title: 'Requirement Document', wbsType: 'TASK', milestone: 'Requirement Complete', children: [
            { key: 'p1t2a', title: 'Draft requirements', wbsType: 'SUBTASK', assignee: 'agent3', status: 'COMPLETED', completionPct: 100, durationDays: 2, start: -20, dep: 'p1t1b' },
            { key: 'p1t2b', title: 'Review & sign-off', wbsType: 'SUBTASK', assignee: 'agent1', status: 'COMPLETED', completionPct: 100, durationDays: 1, start: -18, dep: 'p1t2a' },
          ]},
        ]},
        { key: 'p2', title: 'Blueprint', wbsType: 'PHASE', milestone: 'Blueprint', children: [
          { key: 'p2t1', title: 'Prepare Blueprint', wbsType: 'TASK', milestone: 'Blueprint', children: [
            { key: 'p2t1a', title: 'Solution design', wbsType: 'SUBTASK', assignee: 'agent3', status: 'IN_PROGRESS', completionPct: 60, durationDays: 4, start: -16, priority: 'HIGH', critical: true },
            { key: 'p2t1b', title: 'Data model', wbsType: 'SUBTASK', assignee: 'agent4', status: 'IN_PROGRESS', completionPct: 40, durationDays: 3, start: -12, dep: 'p2t1a' },
          ]},
          { key: 'p2t2', title: 'Review Blueprint', wbsType: 'TASK', milestone: 'Blueprint', assignee: 'agent1', status: 'REVIEW', completionPct: 50, durationDays: 2, start: -8, dep: 'p2t1b' },
          { key: 'p2m', title: 'Blueprint Approval', wbsType: 'MILESTONE', milestone: 'Blueprint', status: 'TODO', durationDays: 0, start: -6 },
        ]},
        { key: 'p3', title: 'Development', wbsType: 'PHASE', milestone: 'Development', children: [
          { key: 'p3t1', title: 'Finance System Configuration', wbsType: 'TASK', milestone: 'Development', priority: 'HIGH', children: [
            { key: 'p3t1a', title: 'Company Setup', wbsType: 'SUBTASK', assignee: 'agent2', status: 'TODO', durationDays: 1, start: 0 },
            { key: 'p3t1b', title: 'Master Data Setup', wbsType: 'SUBTASK', assignee: 'agent2', status: 'TODO', durationDays: 2, start: 1, dep: 'p3t1a' },
            { key: 'p3t1c', title: 'Transactions Setup', wbsType: 'SUBTASK', assignee: 'agent3', status: 'TODO', durationDays: 3, start: 3, dep: 'p3t1b' },
            { key: 'p3t1d', title: 'Print Form', wbsType: 'SUBTASK', assignee: 'agent3', status: 'TODO', durationDays: 3, start: 6, dep: 'p3t1c' },
          ]},
          { key: 'p3t2', title: 'Custom Reports', wbsType: 'TASK', milestone: 'Development', assignee: 'agent4', status: 'TODO', durationDays: 5, start: 9 },
        ]},
        { key: 'p4', title: 'Testing', wbsType: 'PHASE', milestone: 'Testing', children: [
          { key: 'p4t1', title: 'Unit Testing', wbsType: 'TASK', milestone: 'Testing', assignee: 'agent3', status: 'TODO', durationDays: 3, start: 15 },
          { key: 'p4t2', title: 'UAT', wbsType: 'TASK', milestone: 'Testing', assignee: 'agent1', status: 'TODO', durationDays: 5, start: 18, dep: 'p4t1' },
        ]},
        { key: 'p5', title: 'Training', wbsType: 'PHASE', milestone: 'Training', children: [
          { key: 'p5t1', title: 'End-user Training', wbsType: 'TASK', milestone: 'Training', assignee: 'agent2', status: 'TODO', durationDays: 4, start: 24 },
        ]},
        { key: 'p6', title: 'Go Live', wbsType: 'PHASE', milestone: 'Go Live', children: [
          { key: 'p6t1', title: 'Cutover', wbsType: 'TASK', milestone: 'Go Live', assignee: 'agent4', status: 'TODO', durationDays: 2, start: 30, critical: true },
          { key: 'p6m', title: 'Go Live', wbsType: 'MILESTONE', milestone: 'Go Live', status: 'TODO', durationDays: 0, start: 33 },
        ]},
      ],
    },
    {
      name: 'Website Revamp', key: 'WEB', status: 'IN_PROGRESS', priority: 'MEDIUM',
      manager: 'agent2', start: -10, end: 30,
      members: [{ u: 'agent2', role: 'MANAGER' }, { u: 'agent5' }],
      wbs: [
        { key: 'w1', title: 'Design', wbsType: 'PHASE', milestone: 'Blueprint', children: [
          { key: 'w1a', title: 'Wireframes', wbsType: 'TASK', milestone: 'Blueprint', assignee: 'agent5', status: 'COMPLETED', completionPct: 100, durationDays: 3, start: -10 },
          { key: 'w1b', title: 'Visual design', wbsType: 'TASK', milestone: 'Blueprint', assignee: 'agent2', status: 'IN_PROGRESS', completionPct: 50, durationDays: 5, start: -6, dep: 'w1a' },
        ]},
        { key: 'w2', title: 'Build', wbsType: 'PHASE', milestone: 'Development', children: [
          { key: 'w2a', title: 'Frontend', wbsType: 'TASK', milestone: 'Development', assignee: 'agent5', status: 'TODO', durationDays: 8, start: 2, dep: 'w1b' },
        ]},
      ],
    },
  ];

  for (const spec of specs) {
    const seq = await prisma.client.update({ where: { id: clientId }, data: { projectSequence: { increment: 1 } } });
    const projectNumber = `PRJ-${String(seq.projectSequence).padStart(6, '0')}`;
    const project = await prisma.project.create({
      data: {
        clientId, projectNumber, name: `${SAMPLE} ${spec.name}`, key: spec.key,
        description: `${spec.name} — WBS sample for feature verification.`,
        status: spec.status, priority: spec.priority,
        managerUserId: uid(spec.manager), managerName: uname(spec.manager),
        startDate: day(spec.start), endDate: day(spec.end),
        createdBy: uid('admin'), createdByName: 'admin', updatedBy: uid('admin'),
      },
    });

    // Milestones (8 defaults) → id by name.
    const msByName: Record<string, string> = {};
    for (const [i, name] of DEFAULT_MILESTONES.entries()) {
      const m = await prisma.projectMilestone.create({ data: { projectId: project.id, name, sortOrder: i, createdBy: uid('admin') } });
      msByName[name] = m.id;
    }

    // Recursively insert the WBS tree; capture id + wbs code per key.
    const idByKey: Record<string, string> = {};
    const depByKey: Record<string, string | undefined> = {};
    let taskNumber = 0;
    const insert = async (node: Node, parentId: string | null, code: string) => {
      taskNumber += 1;
      const created = await prisma.projectTask.create({
        data: {
          projectId: project.id,
          parentTaskId: parentId,
          milestoneId: node.milestone ? msByName[node.milestone] ?? null : null,
          taskNumber,
          wbsType: node.wbsType,
          wbsCode: code,
          type: node.wbsType === 'MILESTONE' ? 'MILESTONE' : 'TASK',
          title: node.title,
          description: `${node.title} — ${node.wbsType.toLowerCase()} under the ${spec.name} plan.`,
          status: node.status ?? 'TODO',
          completionPct: node.status === 'COMPLETED' ? 100 : (node.completionPct ?? 0),
          priority: node.priority ?? null,
          durationDays: node.children?.length ? null : (node.durationDays ?? null),
          startDate: node.start != null ? day(node.start) : null,
          dueDate: node.start != null && node.durationDays != null ? day(node.start + node.durationDays) : null,
          assigneeUserId: node.assignee ? uid(node.assignee) : null,
          assigneeName: node.assignee ? uname(node.assignee) : null,
          critical: node.critical ?? false,
          sortOrder: taskNumber,
          completedAt: node.status === 'COMPLETED' ? day(node.start ?? 0) : null,
          createdBy: uid('admin'), createdByName: 'admin', updatedBy: uid('admin'),
        },
      });
      idByKey[node.key] = created.id;
      depByKey[node.key] = node.dep;
      let i = 0;
      for (const child of node.children ?? []) { i += 1; await insert(child, created.id, `${code}.${i}`); }
    };
    let top = 0;
    for (const node of spec.wbs) { top += 1; await insert(node, null, String(top)); }
    await prisma.project.update({ where: { id: project.id }, data: { taskSequence: taskNumber } });

    // Dependencies (predecessor → this).
    for (const [key, dep] of Object.entries(depByKey)) {
      if (dep && idByKey[dep] && idByKey[key]) {
        await prisma.projectTaskDependency.create({ data: { predecessorId: idByKey[dep], successorId: idByKey[key] } });
      }
    }

    // A demo sprint on the first project with a couple of dev tasks.
    if (spec.key === 'ERP') {
      const s1 = await prisma.projectSprint.create({ data: { projectId: project.id, name: 'Sprint 1', goal: 'Finance configuration', status: 'ACTIVE', createdBy: uid('admin') } });
      for (const k of ['p3t1a', 'p3t1b']) {
        if (idByKey[k]) await prisma.projectTask.update({ where: { id: idByKey[k] }, data: { sprintId: s1.id, storyPoints: 3 } });
      }
      // Demo comment + watcher on Solution design.
      if (idByKey['p2t1a']) {
        await prisma.projectTaskComment.create({ data: { taskId: idByKey['p2t1a'], authorUserId: uid('agent1'), authorName: 'agent1', body: '@agent3 share the latest design doc before review.' } });
        await prisma.projectTaskWatcher.upsert({ where: { taskId_userId: { taskId: idByKey['p2t1a'], userId: uid('agent1')! } }, create: { taskId: idByKey['p2t1a'], userId: uid('agent1')! }, update: {} });
      }
      // Resources plan
      const plan = [
        { u: 'agent1', cat: 'Project Manager', role: 'PM', alloc: 50 },
        { u: 'agent2', cat: 'Sr Developer', role: 'Lead Dev', alloc: 100 },
        { u: 'agent3', cat: 'Sr Developer', role: 'Developer', alloc: 100 },
        { u: 'agent4', cat: 'Jr Developer', role: 'Developer', alloc: 80 },
      ];
      for (const r of plan) {
        await prisma.projectResource.create({
          data: { projectId: project.id, userId: uid(r.u), consultantName: r.u, categoryId: catByName[r.cat], role: r.role, allocationPct: r.alloc, dailyHours: 8, billable: true, startDate: day(spec.start), endDate: day(spec.end), createdBy: uid('admin') },
        });
      }
      // A few timesheet entries
      const ts = [
        { u: 'agent2', d: -3, act: 'Solution design', h: 8, w: 'Drafted the finance module solution design.' },
        { u: 'agent3', d: -2, act: 'Data model', h: 6, w: 'Defined core data model entities.' },
        { u: 'agent2', d: -1, act: 'Solution design', h: 7, w: 'Reviewed design with stakeholders.' },
      ];
      for (const e of ts) {
        await prisma.projectTimesheet.create({
          data: { projectId: project.id, userId: uid(e.u), consultantName: e.u, date: day(e.d), activity: e.act, hours: e.h, workPerformed: e.w, status: 'SUBMITTED', createdBy: uid('admin') },
        });
      }
      // Governance registers
      await prisma.projectRisk.createMany({ data: [
        { projectId: project.id, title: 'Barcode printer unavailable', probability: 'HIGH', impact: 'MEDIUM', mitigation: 'Procure backup printer', ownerName: 'agent4', status: 'OPEN', createdBy: uid('admin') },
        { projectId: project.id, title: 'Key SME on leave during UAT', probability: 'MEDIUM', impact: 'HIGH', mitigation: 'Cross-train a backup', ownerName: 'agent1', status: 'MITIGATED', createdBy: uid('admin') },
      ]});
      await prisma.projectIssue.createMany({ data: [
        { projectId: project.id, title: 'LMS throws 500 on import', priority: 'HIGH', ownerName: 'agent3', targetDate: day(5), status: 'IN_PROGRESS', createdBy: uid('admin') },
      ]});
      await prisma.projectChangeRequest.createMany({ data: [
        { projectId: project.id, title: 'Add multi-currency support', description: 'Client requested multi-currency invoicing', reason: 'New requirement', scheduleImpact: '+5 days', budgetImpact: 12000, status: 'SUBMITTED', requestedBy: 'Customer', createdBy: uid('admin') },
      ]});
      // Stage-gate sign-off now lives on the milestones themselves.
      if (msByName['Blueprint']) await prisma.projectMilestone.update({ where: { id: msByName['Blueprint'] }, data: { approverName: 'agent1', approvalStatus: 'APPROVED', decidedAt: day(-6) } });
      await prisma.projectMeeting.create({ data: { projectId: project.id, title: 'Project Kickoff', date: day(-20), attendees: 'agent1, agent2, agent3, Customer', notes: 'Reviewed scope and timeline.', actionItems: [{ text: 'Share project plan', owner: 'agent1', done: true }, { text: 'Set up dev environment', owner: 'agent3', done: false }], createdBy: uid('admin') } });
      await prisma.projectDocument.createMany({ data: [
        { projectId: project.id, docType: 'Blueprint', name: 'Solution Blueprint v1.2', versionNumber: '1.2', filePath: 'https://example.com/blueprint.pdf', uploadedBy: uid('admin') },
        { projectId: project.id, docType: 'Requirement', name: 'BRD', versionNumber: '1.0', filePath: 'https://example.com/brd.docx', uploadedBy: uid('admin') },
      ]});
      // Financials: expenses + customer invoices + a project budget
      await prisma.project.update({ where: { id: project.id }, data: { budget: 150000, currency: 'USD', projectType: 'Implementation', department: 'IT', projectSponsor: 'CIO' } });
      await prisma.projectExpense.createMany({ data: [
        { projectId: project.id, category: 'Travel', description: 'Onsite kickoff travel', amount: 3200, date: day(-18), createdBy: uid('admin') },
        { projectId: project.id, category: 'Hardware', description: 'Barcode printers', amount: 4500, date: day(-5), createdBy: uid('admin') },
        { projectId: project.id, category: 'Software', description: 'License renewal', amount: 6800, date: day(-2), createdBy: uid('admin') },
        { projectId: project.id, category: 'Training', description: 'End-user training material', amount: 1500, date: day(10), createdBy: uid('admin') },
      ]});
      await prisma.projectInvoice.createMany({ data: [
        { projectId: project.id, invoiceNumber: 'INV-001', invoiceDate: day(-15), amount: 40000, amountPaid: 40000, type: 'Fixed Price', status: 'PAID', createdBy: uid('admin') },
        { projectId: project.id, invoiceNumber: 'INV-002', invoiceDate: day(-2), amount: 35000, amountPaid: 10000, type: 'Time & Material', status: 'SENT', createdBy: uid('admin') },
      ]});
    }
  }

  // Link a sample ticket to the first sample project.
  const firstProject = await prisma.project.findFirst({ where: { clientId, name: { startsWith: SAMPLE } }, orderBy: { projectNumber: 'asc' } });
  const sampleTicket = await prisma.ticket.findFirst({ where: { clientId, subject: { startsWith: '[SAMPLE]' }, projectId: null } });
  if (firstProject && sampleTicket) {
    await prisma.ticket.update({ where: { id: sampleTicket.id }, data: { projectId: firstProject.id } });
  }

  const totalTasks = specs.reduce((n, s) => n + countNodes(s.wbs), 0);
  console.log('Project WBS sample data seeded.');
  console.log(`Projects: ${specs.length} (prefixed "${SAMPLE}") · WBS nodes: ${totalTasks} · Milestones: ${DEFAULT_MILESTONES.length}/project`);
  console.log('Log in as admin / Admin@123 → Projects.');
}

function countNodes(nodes: Node[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children ?? []), 0);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
