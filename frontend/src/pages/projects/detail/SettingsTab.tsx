import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CURRENCIES, convertAmount, formatMoney } from '@/lib/currencies';
import { DateField } from '@/components/ui/date-field';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { invalidateProject, type ProjectDetail } from '../projectMeta';
import { UPLOAD_TYPE_CATALOG, ATTACHMENT_SUBMODULES, DEFAULT_UPLOAD_EXTS } from '../../../lib/uploads';
import { GANTT_COLORS, resolveGanttColors, defaultGanttColors, type GanttColorMap } from './ganttColors';

const FEATURES: { key: string; label: string; desc: string; default: boolean }[] = [
  { key: 'timeTracking', label: 'Time tracking', desc: 'Let members log time spent on tasks.', default: false },
  { key: 'sprints', label: 'Go agile with Sprints', desc: 'Enable the Backlog and Sprints board.', default: true },
  { key: 'cascadingDates', label: 'Cascading dates', desc: 'Push later tasks forward automatically when a task is extended.', default: true },
];

const toDate = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

// Module-scope so inputs keep a stable identity (no focus loss on keystroke).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-sm">{label}</div>{children}</div>;
}

const NO_COMPANY = '__none__';

export default function SettingsTab({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  // Customer companies to link this project to (drives the meeting attendee list).
  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });
  const [f, setF] = useState({
    name: project.name, key: project.key ?? '', projectCode: project.projectCode ?? '',
    projectSponsor: project.projectSponsor ?? '', department: project.department ?? '',
    customerCompanyId: project.customerCompanyId ?? '',
    // project.budget is a Prisma Decimal serialized as a string — coerce to a real number.
    budget: project.budget == null ? null : Number(project.budget),
    currency: project.currency || 'USD', projectType: project.projectType ?? '',
    startDate: toDate(project.startDate), endDate: toDate(project.endDate),
    goLiveDate: toDate(project.goLiveDate), description: project.description ?? '',
    objective: project.objective ?? '', scope: project.scope ?? '', outOfScope: project.outOfScope ?? '', successCriteria: project.successCriteria ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const invalidate = () => invalidateProject(qc);

  const saveGeneral = useMutation({
    mutationFn: () => api.patch(`/api/projects/${project.id}`, {
      name: f.name.trim(), key: f.key.trim() || undefined, projectCode: f.projectCode, projectSponsor: f.projectSponsor,
      department: f.department, customerCompanyId: f.customerCompanyId || null, budget: f.budget ?? undefined, currency: f.currency, projectType: f.projectType,
      startDate: f.startDate || undefined, endDate: f.endDate || undefined,
      goLiveDate: f.goLiveDate || undefined, description: f.description, objective: f.objective, scope: f.scope, outOfScope: f.outOfScope, successCriteria: f.successCriteria,
    }),
    onSuccess: () => { invalidate(); toast.success('Saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving'),
  });
  const toggleFeature = useMutation({
    mutationFn: (features: Record<string, boolean>) => api.patch(`/api/projects/${project.id}`, { features }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating features'),
  });

  const features = project.features ?? {};
  const isOn = (feat: (typeof FEATURES)[number]) => features[feat.key] ?? feat.default;

  // Allowed attachment file types per submodule (defaults to the standard set when unset).
  const savedTypes = (features.attachmentTypes ?? {}) as Record<string, string[]>;
  const [types, setTypes] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(ATTACHMENT_SUBMODULES.map((m) => [m.entityType, savedTypes[m.entityType] ?? DEFAULT_UPLOAD_EXTS])),
  );
  const toggleType = (entityType: string, ext: string) =>
    setTypes((s) => {
      const cur = s[entityType] ?? [];
      return { ...s, [entityType]: cur.includes(ext) ? cur.filter((e) => e !== ext) : [...cur, ext] };
    });
  const saveTypes = useMutation({
    mutationFn: () => api.patch(`/api/projects/${project.id}`, { features: { ...features, attachmentTypes: types } }),
    onSuccess: () => { invalidate(); toast.success('Attachment types saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving'),
  });

  // Gantt chart bar colours (saved under features.ganttColors).
  const [gColors, setGColors] = useState<GanttColorMap>(() => resolveGanttColors(project.features));
  const saveColors = useMutation({
    mutationFn: () => api.patch(`/api/projects/${project.id}`, { features: { ...features, ganttColors: gColors } }),
    onSuccess: () => { invalidate(); toast.success('Gantt colours saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving'),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-sm">Project header</CardTitle></CardHeader>
        <CardContent className="space-y-4 pb-6">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Project key"><Input value={f.key} onChange={(e) => set({ key: e.target.value })} placeholder="e.g. ERP" /></Field>
            <Field label="Project code"><Input value={f.projectCode} onChange={(e) => set({ projectCode: e.target.value })} /></Field>
            <Field label="Sponsor"><Input value={f.projectSponsor} onChange={(e) => set({ projectSponsor: e.target.value })} /></Field>
            <Field label="Department"><Input value={f.department} onChange={(e) => set({ department: e.target.value })} /></Field>
            <Field label="Customer company">
              <Select
                value={f.customerCompanyId || NO_COMPANY}
                onValueChange={(v) => set({ customerCompanyId: v === NO_COMPANY ? '' : v })}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COMPANY}>None</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Project type"><Input value={f.projectType} onChange={(e) => set({ projectType: e.target.value })} placeholder="Implementation" /></Field>
            {/* Budget is set at project creation; here it's read-only and re-expressed
                whenever the currency changes below. */}
            <Field label="Budget">
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-foreground">
                {formatMoney(f.budget, f.currency)}
              </div>
            </Field>
            <Field label="Currency">
              <Select
                value={f.currency}
                onValueChange={(next) =>
                  setF((s) => ({
                    ...s,
                    budget: s.budget == null ? s.budget : convertAmount(s.budget, s.currency, next),
                    currency: next,
                  }))
                }
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start date"><DateField value={f.startDate} onChange={(v) => set({ startDate: v })} max={f.endDate || undefined} /></Field>
            <Field label="End date"><DateField value={f.endDate} onChange={(v) => set({ endDate: v })} min={f.startDate || undefined} /></Field>
            <Field label="Go-live date"><DateField value={f.goLiveDate} onChange={(v) => set({ goLiveDate: v })} /></Field>
          </div>
          <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Objective"><Textarea rows={2} value={f.objective} onChange={(e) => set({ objective: e.target.value })} /></Field>
            <Field label="Success criteria"><Textarea rows={2} value={f.successCriteria} onChange={(e) => set({ successCriteria: e.target.value })} /></Field>
            <Field label="Scope"><Textarea rows={2} value={f.scope} onChange={(e) => set({ scope: e.target.value })} /></Field>
            <Field label="Out of scope"><Textarea rows={2} value={f.outOfScope} onChange={(e) => set({ outOfScope: e.target.value })} /></Field>
          </div>
          <p className="text-xs text-muted-foreground">Changing the Start/End widens or tightens the timeline for the whole WBS — any phase, task, sub-task or activity that would fall outside the new window is pulled back to the nearest edge.</p>
          <Button disabled={saveGeneral.isPending} onClick={() => saveGeneral.mutate()}>
            {saveGeneral.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Project features</CardTitle></CardHeader>
        <CardContent className="space-y-4 pb-6">
          {FEATURES.map((feat) => (
            <div key={feat.key} className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">{feat.label}</div>
                <div className="text-xs text-muted-foreground">{feat.desc}</div>
              </div>
              <Switch
                checked={isOn(feat)}
                onCheckedChange={(v) => toggleFeature.mutate({ ...features, [feat.key]: v })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Attachment file types</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pb-6">
          <p className="text-xs text-muted-foreground">Choose which file types can be uploaded in each submodule. Links are always allowed. Max size is 5 MB.</p>
          {ATTACHMENT_SUBMODULES.map((m) => (
            <div key={m.entityType}>
              <div className="mb-1.5 text-sm font-medium text-foreground">{m.label}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {UPLOAD_TYPE_CATALOG.map((t) => (
                  <label key={t.ext} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={(types[m.entityType] ?? []).includes(t.ext)}
                      onCheckedChange={() => toggleType(m.entityType, t.ext)}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <Button disabled={saveTypes.isPending} onClick={() => saveTypes.mutate()}>
            {saveTypes.isPending ? 'Saving...' : 'Save file types'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Gantt chart colours</CardTitle></CardHeader>
        <CardContent className="space-y-4 pb-6">
          <p className="text-xs text-muted-foreground">Colours for the bars and legend on the Tasks → Gantt timeline.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {GANTT_COLORS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input
                  type="color"
                  className="h-8 w-10 cursor-pointer rounded border border-input bg-transparent p-0.5"
                  value={gColors[c.key]}
                  onChange={(e) => setGColors((s) => ({ ...s, [c.key]: e.target.value }))}
                />
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-3 rounded-[3px]" style={{ backgroundColor: gColors[c.key] }} />
                  {c.label}
                </span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button disabled={saveColors.isPending} onClick={() => saveColors.mutate()}>
              {saveColors.isPending ? 'Saving...' : 'Save colours'}
            </Button>
            <Button variant="outline" onClick={() => setGColors(defaultGanttColors())}>Reset to defaults</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
