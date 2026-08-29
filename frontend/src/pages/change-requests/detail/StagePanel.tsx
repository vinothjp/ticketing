import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Gavel, Lock } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DateField } from '@/components/ui/date-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OptionSelect, EntitySelect } from '../OptionSelect';
import { useAuth } from '../../../context/AuthContext';
import {
  CHANGE_STAGES, CAB_STAGE, CAB_TYPES, stageIndex, dateVal, type ChangeRequest,
} from '../changeRequestMeta';
import { Field } from './section';
import CrAttachments from './CrAttachments';

// Only the fields a stage owns live here — the change's own content sits in the
// left-hand ContentPanel and stays editable at every stage.
const seed = (cr: ChangeRequest) => ({
  // Planning
  impact: cr.impact ?? '',
  risk: cr.risk ?? '',
  benefitToCustomer: cr.benefitToCustomer ?? '',
  servicesAffected: cr.servicesAffected ?? '',
  crStartDate: dateVal(cr.crStartDate),
  crEndDate: dateVal(cr.crEndDate),
  implementor: cr.implementor ?? '',
  lineManager: cr.lineManager ?? '',
  reviewer: cr.reviewer ?? '',
  // CAB Evaluation
  changeApproverUserId: cr.changeApproverUserId ?? '',
  // Implementation (formerly the Development section)
  developer: cr.developer ?? '',
  developmentStatus: cr.developmentStatus ?? '',
  developmentStartDate: dateVal(cr.developmentStartDate),
  completionDate: dateVal(cr.completionDate),
  transportNumber: cr.transportNumber ?? '',
  gitRepository: cr.gitRepository ?? '',
  buildNumber: cr.buildNumber ?? '',
  // UAT (formerly the Testing section)
  testCase: cr.testCase ?? '',
  testingPerson: cr.testingPerson ?? '',
  testingStatus: cr.testingStatus ?? '',
  uatPerformedBy: cr.uatPerformedBy ?? '',
  defectCount: cr.defectCount === null || cr.defectCount === undefined ? '' : String(cr.defectCount),
  retest: cr.retest ?? '',
  testApproval: cr.testApproval ?? '',
  // Release (formerly the Deployment section)
  deploymentPlan: cr.deploymentPlan ?? '',
  goLiveChecklist: cr.goLiveChecklist ?? '',
  rollbackPlan: cr.rollbackPlan ?? '',
  transportList: cr.transportList ?? '',
  deploymentDate: dateVal(cr.deploymentDate),
  supportWindow: cr.supportWindow ?? '',
});

type FormKey = keyof ReturnType<typeof seed>;
type StaffUser = { id: string; username: string; name?: string | null };
const staffLabel = (u: StaffUser) => (u.name?.trim() ? u.name : u.username);

// Which form keys each stage owns (persisted on Save/Done for that stage).
const OWNED: Record<string, FormKey[]> = {
  Submission: [],
  Planning: ['impact', 'risk', 'benefitToCustomer', 'servicesAffected', 'crStartDate', 'crEndDate', 'implementor', 'lineManager', 'reviewer'],
  'CAB Evaluation': ['changeApproverUserId'],
  Implementation: ['developer', 'developmentStatus', 'developmentStartDate', 'completionDate', 'transportNumber', 'gitRepository', 'buildNumber'],
  UAT: ['testCase', 'testingPerson', 'testingStatus', 'uatPerformedBy', 'defectCount', 'retest', 'testApproval'],
  Release: ['deploymentPlan', 'goLiveChecklist', 'rollbackPlan', 'transportList', 'deploymentDate', 'supportWindow'],
  Review: [],
  Close: [],
};

// Keys that must reach the API as a date-or-null rather than an empty string.
const DATE_KEYS: FormKey[] = ['crStartDate', 'crEndDate', 'developmentStartDate', 'completionDate', 'deploymentDate'];

export default function StagePanel({ cr, stage }: { cr: ChangeRequest; stage: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState(() => seed(cr));
  const [note, setNote] = useState((cr.stageNotes ?? {})[stage] ?? '');
  const [rejecting, setRejecting] = useState(false);
  const [cabReason, setCabReason] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => { setForm(seed(cr)); setNote((cr.stageNotes ?? {})[stage] ?? ''); setRejecting(false); }, [cr.id, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: staff = [] } = useQuery<StaffUser[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
    enabled: stage === CAB_STAGE,
  });

  const current = stageIndex(cr.stage);
  const idx = stageIndex(stage);
  const relation = idx < current ? 'done' : idx === current ? 'current' : 'future';
  const nextStage = CHANGE_STAGES[current + 1];
  const cabRequired = !!cr.changeType && CAB_TYPES.includes(cr.changeType);
  const readOnly = relation === 'future';
  const canAdvance = relation === 'current' && !!nextStage;
  const canDecideCab = !!user && (user.roles.includes('Admin') || (!!cr.changeApproverUserId && cr.changeApproverUserId === user.id));

  const buildPayload = () => {
    const payload: Record<string, unknown> = {};
    for (const k of OWNED[stage] ?? []) {
      const v = form[k];
      if (k === 'changeApproverUserId') payload[k] = v || null;
      else if (DATE_KEYS.includes(k)) payload[k] = v || null;
      else if (k === 'defectCount') payload[k] = String(v).trim() ? Number(v) : null;
      else payload[k] = v;
    }
    payload.stageNotes = { ...(cr.stageNotes ?? {}), [stage]: note };
    return payload;
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ['change-requests'] });

  const save = useMutation({
    mutationFn: () => api.patch(`/api/change-requests/${cr.id}`, buildPayload()),
    onSuccess: () => { invalidate(); toast.success('Stage saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not save'),
  });

  const done = useMutation({
    mutationFn: async () => {
      await api.patch(`/api/change-requests/${cr.id}`, buildPayload());
      await api.post(`/api/change-requests/${cr.id}/advance-stage`, { targetStage: nextStage });
    },
    onSuccess: () => { invalidate(); toast.success(`Completed ${stage} → ${nextStage}`); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not complete the stage'),
  });

  const decide = useMutation({
    mutationFn: (payload: { decision: 'APPROVED' | 'REJECTED'; reason?: string }) =>
      api.post(`/api/change-requests/${cr.id}/cab-decision`, payload),
    onSuccess: (_d, v) => { invalidate(); setRejecting(false); setCabReason(''); toast.success(`CAB ${v.decision === 'APPROVED' ? 'approved' : 'rejected'}`); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not record the CAB decision'),
  });

  const busy = save.isPending || done.isPending;
  const relationBadge = useMemo(() => {
    if (relation === 'done') return <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Completed</span>;
    if (relation === 'current') return <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Current stage</span>;
    return <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><Lock className="h-3 w-3" />Locked</span>;
  }, [relation]);

  return (
    <div className="overflow-hidden rounded-xl border lg:sticky lg:top-4">
      {/* The stage's one action sits in the header, beside its name: on the
          current stage it saves and advances, and on a stage that cannot advance
          (an earlier one, or Close) it just saves. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground" title={stage}>{stage}</span>
          {relationBadge}
        </div>
        {!readOnly && (canAdvance ? (
          <Button size="sm" disabled={busy} title={`Save this stage and move the change to ${nextStage}`} onClick={() => done.mutate()}>
            <Check className="mr-1 h-3.5 w-3.5" />Move to {nextStage}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => save.mutate()}>Save</Button>
        ))}
      </div>
      <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto p-4">
        {readOnly && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            This stage becomes active once the previous stage is completed. You can view it, but not edit or complete it yet.
          </p>
        )}

        <fieldset disabled={readOnly} className="space-y-3 disabled:opacity-70">
          {stage === 'Submission' && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Submission is the change's own details — fill them in on the left, then move the change on from here.
            </p>
          )}

          {stage === 'Planning' && (
            <>
              <Field label="Impact"><OptionSelect listKey="impact" value={form.impact} onChange={(v) => set({ impact: v })} /></Field>
              <Field label="Risk"><OptionSelect listKey="risk" value={form.risk} onChange={(v) => set({ risk: v })} /></Field>
              <Field label="Benefit to business of the change"><Textarea rows={2} value={form.benefitToCustomer} onChange={(e) => set({ benefitToCustomer: e.target.value })} /></Field>
              <Field label="Services Affected"><Textarea rows={2} value={form.servicesAffected} onChange={(e) => set({ servicesAffected: e.target.value })} /></Field>
              <Field label="Scheduled Start Date"><DateField value={form.crStartDate} onChange={(v) => set({ crStartDate: v })} /></Field>
              <Field label="Scheduled End Date"><DateField value={form.crEndDate} onChange={(v) => set({ crEndDate: v })} min={form.crStartDate || undefined} /></Field>
              <Field label="Implementor"><EntitySelect source="person" value={form.implementor} onChange={(v) => set({ implementor: v })} /></Field>
              <Field label="Line Manager"><EntitySelect source="person" value={form.lineManager} onChange={(v) => set({ lineManager: v })} /></Field>
              <Field label="Reviewer"><EntitySelect source="person" value={form.reviewer} onChange={(v) => set({ reviewer: v })} /></Field>
            </>
          )}

          {stage === CAB_STAGE && (
            <>
              <Field label="Change Approver">
                {/* A real staff user (shown by full name), not a free-text name —
                    this identity is what authorises the CAB decision below.
                    Ignore Radix's empty re-emission so an async-loaded value isn't wiped. */}
                <Select value={form.changeApproverUserId || undefined} onValueChange={(v) => { if (v) set({ changeApproverUserId: v }); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select a staff member" /></SelectTrigger>
                  <SelectContent>{staff.map((u) => <SelectItem key={u.id} value={u.id}>{staffLabel(u)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="CAB approval status">
                <div className="flex min-h-9 items-center text-sm">
                  {cr.cabApprovalStatus === 'APPROVED' ? <span className="font-medium text-emerald-600 dark:text-emerald-400">Approved</span>
                    : cr.cabApprovalStatus === 'REJECTED' ? <span className="font-medium text-destructive">Rejected{cr.cabReason ? ` · ${cr.cabReason}` : ''}</span>
                    : cabRequired ? <span className="font-medium text-amber-600 dark:text-amber-400">Pending decision</span>
                    : <span className="text-muted-foreground">Not required for {cr.changeType || 'this change'}</span>}
                </div>
              </Field>
              {cabRequired && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <Gavel className="h-4 w-4 shrink-0" />CAB decision — required before this stage can complete
                  </span>
                  {canDecideCab && cr.cabApprovalStatus !== 'APPROVED' && !rejecting && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'APPROVED' })}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setRejecting(true)}>Reject</Button>
                    </div>
                  )}
                  {!canDecideCab && cr.cabApprovalStatus !== 'APPROVED' && cr.cabApprovalStatus !== 'REJECTED' && (
                    <p className="mt-2 text-xs text-muted-foreground">Awaiting the Change Approver's decision.</p>
                  )}
                  {canDecideCab && rejecting && (
                    <div className="mt-2 space-y-2">
                      <Textarea rows={2} placeholder="Reason for rejection" value={cabReason} onChange={(e) => setCabReason(e.target.value)} />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => { setRejecting(false); setCabReason(''); }}>Cancel</Button>
                        <Button size="sm" variant="destructive" disabled={!cabReason.trim() || decide.isPending} onClick={() => decide.mutate({ decision: 'REJECTED', reason: cabReason.trim() })}>Confirm reject</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {stage === 'Implementation' && (
            <>
              <Field label="Developer"><EntitySelect source="person" value={form.developer} onChange={(v) => set({ developer: v })} /></Field>
              <Field label="Development Status"><OptionSelect listKey="dev_status" value={form.developmentStatus} onChange={(v) => set({ developmentStatus: v })} /></Field>
              <Field label="Development Start"><DateField value={form.developmentStartDate} onChange={(v) => set({ developmentStartDate: v })} /></Field>
              <Field label="Completion Date"><DateField value={form.completionDate} onChange={(v) => set({ completionDate: v })} min={form.developmentStartDate || undefined} /></Field>
              <Field label="Transport Number"><Input value={form.transportNumber} onChange={(e) => set({ transportNumber: e.target.value })} /></Field>
              <Field label="Git Repository"><Input value={form.gitRepository} onChange={(e) => set({ gitRepository: e.target.value })} placeholder="e.g. org/repo or URL" /></Field>
              <Field label="Build Number"><Input value={form.buildNumber} onChange={(e) => set({ buildNumber: e.target.value })} /></Field>
            </>
          )}

          {stage === 'UAT' && (
            <>
              <Field label="Test Case"><Textarea rows={2} value={form.testCase} onChange={(e) => set({ testCase: e.target.value })} /></Field>
              <Field label="Testing Person"><EntitySelect source="person" value={form.testingPerson} onChange={(v) => set({ testingPerson: v })} /></Field>
              <Field label="Testing Status"><OptionSelect listKey="test_status" value={form.testingStatus} onChange={(v) => set({ testingStatus: v })} /></Field>
              <Field label="UAT Performed By"><EntitySelect source="person" value={form.uatPerformedBy} onChange={(v) => set({ uatPerformedBy: v })} /></Field>
              <Field label="Defect Count"><Input type="number" min="0" step="1" value={form.defectCount} onChange={(e) => set({ defectCount: e.target.value })} /></Field>
              <Field label="Retest"><OptionSelect listKey="yes_no" value={form.retest} onChange={(v) => set({ retest: v })} /></Field>
              <Field label="Approval"><OptionSelect listKey="approval" value={form.testApproval} onChange={(v) => set({ testApproval: v })} /></Field>
            </>
          )}

          {stage === 'Release' && (
            <>
              <Field label="Deployment Plan"><Textarea rows={3} value={form.deploymentPlan} onChange={(e) => set({ deploymentPlan: e.target.value })} /></Field>
              <Field label="Go Live Checklist"><Textarea rows={3} value={form.goLiveChecklist} onChange={(e) => set({ goLiveChecklist: e.target.value })} /></Field>
              <Field label="Rollback Plan"><Textarea rows={3} value={form.rollbackPlan} onChange={(e) => set({ rollbackPlan: e.target.value })} /></Field>
              <Field label="Transport List"><Textarea rows={2} value={form.transportList} onChange={(e) => set({ transportList: e.target.value })} /></Field>
              <Field label="Deployment Date"><DateField value={form.deploymentDate} onChange={(v) => set({ deploymentDate: v })} /></Field>
              <Field label="Support Window"><Input value={form.supportWindow} onChange={(e) => set({ supportWindow: e.target.value })} placeholder="e.g. 2 weeks hypercare" /></Field>
            </>
          )}

          <Field label="Stage notes"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Notes for the ${stage} stage`} /></Field>
        </fieldset>

        {/* The UAT sign-off document belongs to the UAT stage, so it travelled
            here with the rest of the old Testing section. */}
        {stage === 'UAT' && (
          <div className="rounded-lg border p-3">
            <h3 className="text-sm font-semibold text-foreground">UAT Document</h3>
            <p className="mb-2 text-xs text-muted-foreground">Attach the UAT sign-off document (upload a file or paste a link).</p>
            <CrAttachments crId={cr.id} entityType="uat" />
          </div>
        )}
      </div>
    </div>
  );
}
