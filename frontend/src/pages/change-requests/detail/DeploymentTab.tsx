import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DateField } from '@/components/ui/date-field';
import { dateVal, type ChangeRequest } from '../changeRequestMeta';
import { Field, Section, useCrSaver } from './section';

const fromCr = (cr: ChangeRequest) => ({
  deploymentPlan: cr.deploymentPlan ?? '',
  goLiveChecklist: cr.goLiveChecklist ?? '',
  rollbackPlan: cr.rollbackPlan ?? '',
  transportList: cr.transportList ?? '',
  deploymentDate: dateVal(cr.deploymentDate),
  supportWindow: cr.supportWindow ?? '',
});

export default function DeploymentTab({ cr }: { cr: ChangeRequest }) {
  const [form, setForm] = useState(() => fromCr(cr));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => { setForm(fromCr(cr)); }, [cr.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saver = useCrSaver(cr.id);
  const save = () => saver.mutate({
    deploymentPlan: form.deploymentPlan,
    goLiveChecklist: form.goLiveChecklist,
    rollbackPlan: form.rollbackPlan,
    transportList: form.transportList,
    deploymentDate: form.deploymentDate || null,
    supportWindow: form.supportWindow,
  });

  return (
    <div className="space-y-4">
      <Section title="Deployment" cols={1}>
        <Field label="Deployment Plan"><Textarea rows={3} value={form.deploymentPlan} onChange={(e) => set({ deploymentPlan: e.target.value })} /></Field>
        <Field label="Go Live Checklist"><Textarea rows={3} value={form.goLiveChecklist} onChange={(e) => set({ goLiveChecklist: e.target.value })} /></Field>
        <Field label="Rollback Plan"><Textarea rows={3} value={form.rollbackPlan} onChange={(e) => set({ rollbackPlan: e.target.value })} /></Field>
        <Field label="Transport List"><Textarea rows={2} value={form.transportList} onChange={(e) => set({ transportList: e.target.value })} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Deployment Date"><DateField value={form.deploymentDate} onChange={(v) => set({ deploymentDate: v })} /></Field>
          <Field label="Support Window"><Input value={form.supportWindow} onChange={(e) => set({ supportWindow: e.target.value })} placeholder="e.g. 2 weeks hypercare" /></Field>
        </div>
      </Section>

      <div className="flex justify-end">
        <Button disabled={saver.isPending} onClick={save}>
          {saver.isPending ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
