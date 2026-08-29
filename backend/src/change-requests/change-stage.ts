// The Change Management stage pipeline. A fixed, ordered list — gating depends on
// the known order (a stage must be completed before the next; no stage-jumping).
// Mirrored on the frontend in pages/change-requests/changeRequestMeta.ts.
export const CHANGE_STAGES = [
  'Submission',
  'Planning',
  'CAB Evaluation',
  'Implementation',
  'UAT',
  'Release',
  'Review',
  'Close',
] as const;

export type ChangeStage = (typeof CHANGE_STAGES)[number];

// The stage at which CAB sign-off is evaluated, and the change types that require it.
// Emergency changes are exempt from CAB approval.
export const CAB_STAGE: ChangeStage = 'CAB Evaluation';
export const CAB_TYPES = ['Major', 'Minor', 'Standard'];

export const stageIndex = (stage?: string | null): number =>
  CHANGE_STAGES.indexOf((stage ?? 'Submission') as ChangeStage);
