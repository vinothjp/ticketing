// Shared types, option-list config, and badge styling for the Change Request module.
import type { QueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

// Refresh every CR list/detail query (keys are prefixed with ['change-requests']).
export const invalidateChangeRequests = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: ['change-requests'], refetchType: 'all' });

// ---- CR option store ----
export interface CrOption {
  id: string;
  listKey: string;
  value: string;
  label: string;
  parentValue?: string | null;
  sortOrder: number;
  isActive: boolean;
}

// React Query factory for one CR option list (kept under its own key prefix so
// invalidating change-request records doesn't refetch every dropdown).
export const crOptionsQuery = (listKey: string) => ({
  queryKey: ['cr-options', listKey],
  queryFn: async () =>
    (await api.get('/api/change-requests/options', { params: { listKey } })).data as CrOption[],
});

// The list registry now lives in the backend (option-lists/default-lists.ts)
// and is managed on the unified Option List screen.

// The Change Management stage pipeline — a fixed, ordered list (mirror of the
// backend change-stage.ts). Gating depends on the order: a stage must be
// completed before the next; no stage-jumping.
export const CHANGE_STAGES = [
  'Submission', 'Planning', 'CAB Evaluation', 'Implementation',
  'UAT', 'Release', 'Review', 'Close',
] as const;
export type ChangeStage = (typeof CHANGE_STAGES)[number];
export const CAB_STAGE: ChangeStage = 'CAB Evaluation';
export const CAB_TYPES = ['Major', 'Minor', 'Standard'];
export const stageIndex = (stage?: string | null) =>
  CHANGE_STAGES.indexOf((stage ?? 'Submission') as ChangeStage);

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'outline';

// Values are human-readable option strings, so match on them directly; anything
// custom (admin-added) falls back to a neutral badge.
export const crStatusVariant = (s?: string | null): BadgeVariant => {
  switch (s) {
    case 'Completed':
    case 'Accepted':
    case 'Deployed': return 'success';
    case 'Approved':
    case 'Submitted for Authorisation':
    case 'Ready for Deployment': return 'default';
    case 'Rejected':
    case 'Cancelled': return 'destructive';
    case 'New':
    case 'Requested': return 'outline';
    default: return 'secondary';
  }
};

export const crPriorityVariant = (p?: string | null): BadgeVariant => {
  switch (p) {
    case 'Critical':
    case 'High': return 'destructive';
    case 'Medium': return 'secondary';
    default: return 'outline';
  }
};

// ---- record shapes ----
export interface ChangeRequestSummary {
  id: string;
  crNumber: string;
  title: string;
  customer?: string | null;
  projectName?: string | null;
  crType?: string | null;
  changeType?: string | null;
  changeOwner?: string | null;
  crCategory?: string | null;
  stage?: string | null;
  // CUSTOMER (raised for a client company) | INTERNAL (our own change, no customer)
  changeSource?: string | null;
  priority?: string | null;
  status: string;
  approvalStatus?: string | null;
  crDate?: string | null;
  createdAt: string;
}

// Customer-approval state shown on the provider's CR list.
export function crApprovalMeta(s?: string | null): { label: string; cls: string } {
  switch (s) {
    case 'PENDING': return { label: 'Awaiting customer', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' };
    case 'APPROVED': return { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' };
    case 'REJECTED': return { label: 'Rejected', cls: 'bg-destructive/15 text-destructive border-destructive/30' };
    default: return { label: 'Not sent', cls: 'bg-muted text-muted-foreground border-border' };
  }
}

export interface ChangeRequest extends ChangeRequestSummary {
  customerCompanyId?: string | null;
  approvalStatus?: string | null;
  approvalReason?: string | null;
  description?: string | null;
  featureName?: string | null;
  moduleName?: string | null;
  crCategory?: string | null;
  // Change Management (ITIL) — General section
  changeType?: string | null;
  changeGroup?: string | null;
  changeOwner?: string | null;
  subCategory?: string | null;
  impact?: string | null;
  servicesAffected?: string | null;
  comments?: string | null;
  stage?: string | null;
  changeCoordinator?: string | null;
  implementor?: string | null;
  lineManager?: string | null;
  reviewer?: string | null;
  changeApprover?: string | null;
  changeApproverUserId?: string | null;
  cabApprovalStatus?: string | null;
  cabReason?: string | null;
  stageNotes?: Record<string, string> | null;
  requestedBy?: string | null;
  businessOwner?: string | null;
  functionalConsultant?: string | null;
  technicalConsultant?: string | null;
  projectManager?: string | null;
  crStartDate?: string | null;
  crEndDate?: string | null;
  targetReleaseDate?: string | null;
  expectedGoLiveDate?: string | null;
  // Business Requirement (Phase 2)
  requirementDetails?: string | null;
  objective?: string | null;
  reasonForCr?: string | null;
  benefitToCustomer?: string | null;
  // Blue Print (Phase 3)
  blueprintName?: string | null;
  blueprintVersionNumber?: string | null;
  blueprintPreparedBy?: string | null;
  blueprintReviewedBy?: string | null;
  blueprintApprovedBy?: string | null;
  blueprintApprovalDate?: string | null;
  blueprintRemarks?: string | null;
  // Impact Analysis (Phase 5)
  affectedModule?: string | null;
  affectedTables?: string | null;
  impactReports?: string | null;
  impactInterfaces?: string | null;
  impactForms?: string | null;
  impactWorkflow?: string | null;
  masterData?: string | null;
  authorizations?: string | null;
  performance?: string | null;
  risk?: string | null;
  estimatedHours?: number | string | null;
  complexity?: string | null;
  // Development Details (Phase 6)
  developer?: string | null;
  developmentStatus?: string | null;
  developmentStartDate?: string | null;
  completionDate?: string | null;
  transportNumber?: string | null;
  gitRepository?: string | null;
  buildNumber?: string | null;
  // Testing (Phase 7)
  testCase?: string | null;
  testingPerson?: string | null;
  testingStatus?: string | null;
  uatPerformedBy?: string | null;
  defectCount?: number | null;
  retest?: string | null;
  testApproval?: string | null;
  // Deployment (Phase 8)
  deploymentPlan?: string | null;
  goLiveChecklist?: string | null;
  rollbackPlan?: string | null;
  transportList?: string | null;
  deploymentDate?: string | null;
  supportWindow?: string | null;
  updatedAt: string;
}

// API returns ISO datetimes; DateField and <input> want "YYYY-MM-DD".
export const dateVal = (v?: string | null) => (v ? v.slice(0, 10) : '');
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : '—');
