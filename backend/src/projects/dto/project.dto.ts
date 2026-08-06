import {
  IsIn, IsInt, IsOptional, IsString, MinLength, IsDateString, Min, Max, IsArray, IsObject, IsBoolean, IsNumber,
} from 'class-validator';

const SPRINT_STATUS = ['PLANNED', 'ACTIVE', 'COMPLETED'];
const PROJECT_STATUS = ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const TASK_TYPE = ['TASK', 'MILESTONE'];
const WBS_TYPE = ['PHASE', 'TASK', 'SUBTASK', 'ACTIVITY', 'CHECKLIST', 'MILESTONE'];
const TASK_STATUS = ['TODO', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'];
const MILESTONE_STATUS = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];

export class CreateProjectDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() key?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(PROJECT_STATUS) status?: string;
  @IsOptional() @IsIn(PRIORITY) priority?: string;
  @IsOptional() @IsString() managerUserId?: string;
  @IsOptional() @IsString() customerCompanyId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsObject() features?: Record<string, any>;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() key?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(PROJECT_STATUS) status?: string;
  @IsOptional() @IsIn(PRIORITY) priority?: string;
  @IsOptional() @IsString() managerUserId?: string;
  @IsOptional() @IsString() customerCompanyId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsObject() features?: Record<string, any>;
  // Header / overview (Excel)
  @IsOptional() @IsString() projectCode?: string;
  @IsOptional() @IsString() projectSponsor?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsNumber() budget?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() projectType?: string;
  @IsOptional() @IsDateString() goLiveDate?: string;
  @IsOptional() @IsString() objective?: string;
  @IsOptional() @IsString() scope?: string;
  @IsOptional() @IsString() outOfScope?: string;
  @IsOptional() @IsString() successCriteria?: string;
}

// Body for linking WBS tasks to a change request.
export class LinkTasksDto {
  @IsArray() @IsString({ each: true }) taskIds!: string[];
}

// Shared WBS task fields (create + update).
class BaseTaskDto {
  @IsOptional() @IsIn(TASK_TYPE) type?: string;
  @IsOptional() @IsIn(WBS_TYPE) wbsType?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() assigneeUserId?: string;
  @IsOptional() @IsIn(TASK_STATUS) status?: string;
  @IsOptional() @IsIn(PRIORITY) priority?: string;
  @IsOptional() @IsString() parentTaskId?: string;
  @IsOptional() @IsString() milestoneId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsDateString() actualStart?: string;
  @IsOptional() @IsDateString() actualFinish?: string;
  @IsOptional() @IsInt() @Min(0) durationDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) completionPct?: number;
  @IsOptional() @IsInt() @Min(0) estimatedHours?: number;
  @IsOptional() @IsInt() @Min(0) actualHours?: number;
  @IsOptional() @IsInt() @Min(0) plannedEffort?: number;
  @IsOptional() @IsInt() @Min(0) storyPoints?: number;
  @IsOptional() @IsBoolean() critical?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

export class CreateProjectTaskDto extends BaseTaskDto {
  @IsString() @MinLength(1) title!: string;
}

export class UpdateProjectTaskDto extends BaseTaskDto {
  @IsOptional() @IsString() @MinLength(1) title?: string;
}

export class UpdateTaskStatusDto {
  @IsIn(TASK_STATUS) status!: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class CreateTaskCommentDto {
  @IsString() @MinLength(1) body!: string;
}

export class AddWatcherDto {
  @IsString() @MinLength(1) userId!: string;
}

export class AddDependencyDto {
  // The predecessor that must complete before this task (the successor).
  @IsString() @MinLength(1) predecessorId!: string;
}

export class CreateSprintDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export class UpdateSprintDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsIn(SPRINT_STATUS) status?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class CreateMilestoneDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsIn(MILESTONE_STATUS) status?: string;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateMilestoneDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(MILESTONE_STATUS) status?: string;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsString() approverName?: string;
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED']) approvalStatus?: string;
}

// ---- Resources plan ----
export class CreateResourceDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() consultantName?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) allocationPct?: number;
  @IsOptional() @IsInt() @Min(1) dailyHours?: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() billable?: boolean;
}
export class UpdateResourceDto extends CreateResourceDto {}

// ---- Timesheets ----
const TIMESHEET_STATUS = ['SUBMITTED', 'APPROVED', 'REJECTED'];
export class CreateTimesheetDto {
  @IsDateString() date!: string;
  @IsNumber() @Min(0) hours!: number;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() consultantName?: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() activity?: string;
  @IsOptional() @IsString() workPerformed?: string;
}
export class UpdateTimesheetDto {
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsNumber() @Min(0) hours?: number;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() activity?: string;
  @IsOptional() @IsString() workPerformed?: string;
  @IsOptional() @IsIn(TIMESHEET_STATUS) status?: string;
}
