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

// Lists shown as tabs on the CR option-manager screen (must match the backend).
export const CR_OPTION_LISTS: { key: string; label: string }[] = [
  { key: 'customer', label: 'Customer' },
  { key: 'project', label: 'Project' },
  { key: 'module', label: 'Module' },
  { key: 'type', label: 'CR Type' },
  { key: 'priority', label: 'Priority' },
  { key: 'category', label: 'CR Category' },
  { key: 'status', label: 'Status' },
  { key: 'person', label: 'People' },
  { key: 'complexity', label: 'Complexity' },
  { key: 'dev_status', label: 'Development Status' },
  { key: 'test_status', label: 'Testing Status' },
  { key: 'doc_title', label: 'Document Title' },
  { key: 'yes_no', label: 'Yes / No' },
  { key: 'approval', label: 'Approval' },
];

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'outline';

// Values are human-readable option strings, so match on them directly; anything
// custom (admin-added) falls back to a neutral badge.
export const crStatusVariant = (s?: string | null): BadgeVariant => {
  switch (s) {
    case 'Completed':
    case 'Deployed': return 'success';
    case 'Approved':
    case 'Ready for Deployment': return 'default';
    case 'Rejected':
    case 'Cancelled': return 'destructive';
    case 'New': return 'outline';
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
  priority?: string | null;
  status: string;
  crDate?: string | null;
  createdAt: string;
}

export interface ChangeRequest extends ChangeRequestSummary {
  description?: string | null;
  featureName?: string | null;
  moduleName?: string | null;
  crCategory?: string | null;
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
