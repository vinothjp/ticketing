// Shared labels, option lists, and badge styling for the Projects module.
import type { QueryClient } from '@tanstack/react-query';

/**
 * Refresh everything that could be affected by a project change so edits in one
 * tab reflect in the others (detail, list, analytics, financials, registers).
 * React Query matches by key prefix, so invalidating `['projects']` covers the
 * whole tree: detail `['projects', id]`, list `['projects','all']`, analytics
 * `['projects','analytics']`, financials `['projects', id,'financials']`, and
 * registers `['projects', id,'registers', …]`. Other users pick changes up on
 * the next refetch (refetch-on-window-focus).
 */
export const invalidateProject = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: ['projects'] });

export const PROJECT_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'] as const;
export const TASK_TYPES = ['TASK', 'MILESTONE'] as const;
export const WBS_TYPES = ['PHASE', 'TASK', 'SUBTASK', 'ACTIVITY', 'CHECKLIST', 'MILESTONE'] as const;
export const MILESTONE_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'outline';

const LABELS: Record<string, string> = {
  OPEN: 'Open', IN_PROGRESS: 'In Progress', ON_HOLD: 'On Hold', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
  TODO: 'To Do', REVIEW: 'Review', DONE: 'Done', PENDING: 'Pending',
  LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent',
  TASK: 'Task', MILESTONE: 'Milestone', PHASE: 'Phase', SUBTASK: 'Sub Task', ACTIVITY: 'Activity', CHECKLIST: 'Checklist',
};

export const labelOf = (v?: string | null) => (v ? LABELS[v] ?? v : '—');

export const projectStatusVariant = (status?: string | null): BadgeVariant => {
  switch (status) {
    case 'COMPLETED': return 'success';
    case 'IN_PROGRESS': return 'default';
    case 'ON_HOLD': return 'secondary';
    case 'CANCELLED': return 'destructive';
    default: return 'outline';
  }
};

export const taskStatusVariant = (status?: string | null): BadgeVariant => {
  switch (status) {
    case 'COMPLETED': return 'success';
    case 'IN_PROGRESS': return 'default';
    case 'REVIEW': return 'secondary';
    default: return 'outline';
  }
};

export const milestoneStatusVariant = (status?: string | null): BadgeVariant =>
  status === 'COMPLETED' ? 'success' : status === 'IN_PROGRESS' ? 'default' : 'outline';

export const priorityVariant = (priority?: string | null): BadgeVariant => {
  switch (priority) {
    case 'URGENT': return 'destructive';
    case 'HIGH': return 'destructive';
    case 'MEDIUM': return 'secondary';
    default: return 'outline';
  }
};

export interface ProjectSummary {
  id: string;
  projectNumber: string;
  name: string;
  key?: string | null;
  status: string;
  priority?: string | null;
  managerUserId?: string | null;
  managerName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  progress: number;
  createdAt: string;
  _count?: { tasks: number; resources: number; tickets: number };
}

export interface ProjectMilestone {
  id: string;
  name: string;
  status: string;         // PENDING | IN_PROGRESS | COMPLETED
  approverName?: string | null;
  approvalStatus?: string;   // PENDING | APPROVED | REJECTED
  decidedAt?: string | null;
  targetDate?: string | null;
  sortOrder: number;
  progress?: number;      // computed % (server)
  taskCount?: number;     // computed (server)
}

export interface ProjectSprint {
  id: string;
  name: string;
  goal?: string | null;
  status: string; // PLANNED | ACTIVE | COMPLETED
  startDate?: string | null;
  endDate?: string | null;
  sortOrder: number;
}

export const sprintStatusVariant = (s?: string | null): BadgeVariant =>
  s === 'ACTIVE' ? 'default' : s === 'COMPLETED' ? 'success' : 'outline';

export interface ProjectTask {
  id: string;
  milestoneId?: string | null;
  sprintId?: string | null;
  storyPoints?: number | null;
  taskNumber?: number | null;
  // WBS
  wbsType: string;
  wbsCode?: string | null;
  durationDays?: number | null;
  completionPct?: number;
  estimatedHours?: number | null;
  actualHours?: number | null;
  actualStart?: string | null;
  actualFinish?: string | null;
  critical?: boolean;
  // Server-computed rollups (parents aggregate children)
  isParent?: boolean;
  rolledDurationDays?: number;
  rolledEstimatedHours?: number | null;
  rolledStart?: string | null;
  rolledEnd?: string | null;
  rolledCompletionPct?: number;
  type: string;
  title: string;
  description?: string | null;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  status: string;
  priority?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  plannedEffort?: number | null;
  parentTaskId?: string | null;
  changeRequestId?: string | null;   // the change request that introduced this task
  sortOrder: number;
  completedAt?: string | null;
  tags?: string[];
  predecessors?: { predecessorId: string }[]; // dependency links where this task is the successor
  _count?: { subtasks: number; comments: number };
}

export interface TaskComment {
  id: string;
  authorUserId?: string | null;
  authorName?: string | null;
  body: string;
  createdAt: string;
}

export interface TaskWatcher {
  id: string;
  userId: string;
  user: { id: string; username: string };
}

export interface DependencyRef {
  id: string;
  taskNumber?: number | null;
  title: string;
  status: string;
}

export interface TaskDetail {
  id: string;
  taskNumber?: number | null;
  wbsType?: string;
  wbsCode?: string | null;
  milestoneId?: string | null;
  sprintId?: string | null;
  durationDays?: number | null;
  completionPct?: number;
  estimatedHours?: number | null;
  actualHours?: number | null;
  critical?: boolean;
  title: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  tags?: string[];
  comments: TaskComment[];
  watchers: TaskWatcher[];
  subtasks: ProjectTask[];
  predecessors: { id: string; predecessor: DependencyRef }[];
  successors: { id: string; successor: DependencyRef }[];
  project?: { key: string | null };
}

export interface LinkedTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  ticketStatus: string;
  priority?: string | null;
}

export interface ResourceCategory {
  id: string;
  name: string;
  hourlyCost: number;
  billingRate: number;
  dailyHours: number;
  dailyCost: number;
  dailyBilling: number;
  profit: number;
  isActive: boolean;
}

export interface ProjectResource {
  id: string;
  userId?: string | null;
  consultantName?: string | null;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  role?: string | null;
  allocationPct: number;
  dailyHours: number;
  startDate?: string | null;
  endDate?: string | null;
  billable: boolean;
  user?: { id: string; username: string } | null;
}

export interface ProjectTimesheet {
  id: string;
  userId?: string | null;
  consultantName?: string | null;
  date: string;
  taskId?: string | null;
  activity?: string | null;
  hours: number | string;
  workPerformed?: string | null;
  status: string;
  user?: { id: string; username: string } | null;
}

export interface ProjectDetail extends ProjectSummary {
  description?: string | null;
  customerCompanyId?: string | null;
  customerCompany?: { id: string; name: string } | null;
  projectCode?: string | null;
  projectSponsor?: string | null;
  department?: string | null;
  budget?: number | string | null;
  currency?: string | null;
  projectType?: string | null;
  goLiveDate?: string | null;
  objective?: string | null;
  scope?: string | null;
  outOfScope?: string | null;
  successCriteria?: string | null;
  milestones: ProjectMilestone[];
  sprints: ProjectSprint[];
  resources: ProjectResource[];
  timesheets: ProjectTimesheet[];
  features?: Record<string, any>;   // feature toggles + attachmentTypes: { [entityType]: string[] }
  tasks: ProjectTask[];
  tickets: LinkedTicket[];
}

// Task key, e.g. "ERP-3". Falls back to "T" when the project has no key set.
export const taskKey = (projectKey: string | null | undefined, taskNumber: number | null | undefined) =>
  taskNumber != null ? `${(projectKey || 'T').toUpperCase()}-${taskNumber}` : '';

export interface UserOption { id: string; username: string; }
export interface CustomerCompanyOption { id: string; name: string; }
