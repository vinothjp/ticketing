import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { OptionSelect, EntitySelect } from '../OptionSelect';
import { type ChangeRequest } from '../changeRequestMeta';
import { Field, Section, useCrSaver } from './section';

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const fromCr = (cr: ChangeRequest) => ({
  affectedModule: cr.affectedModule ?? '',
  complexity: cr.complexity ?? '',
  estimatedHours: str(cr.estimatedHours),
  affectedTables: cr.affectedTables ?? '',
  impactReports: cr.impactReports ?? '',
  impactInterfaces: cr.impactInterfaces ?? '',
  impactForms: cr.impactForms ?? '',
  impactWorkflow: cr.impactWorkflow ?? '',
  masterData: cr.masterData ?? '',
  authorizations: cr.authorizations ?? '',
  performance: cr.performance ?? '',
  risk: cr.risk ?? '',
});

export default function ImpactAnalysisTab({ cr }: { cr: ChangeRequest }) {
  const [form, setForm] = useState(() => fromCr(cr));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => { setForm(fromCr(cr)); }, [cr.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saver = useCrSaver(cr.id);
  const save = () => saver.mutate({
    affectedModule: form.affectedModule,
    complexity: form.complexity,
    estimatedHours: form.estimatedHours.trim() ? Number(form.estimatedHours) : null,
    affectedTables: form.affectedTables,
    impactReports: form.impactReports,
    impactInterfaces: form.impactInterfaces,
    impactForms: form.impactForms,
    impactWorkflow: form.impactWorkflow,
    masterData: form.masterData,
    authorizations: form.authorizations,
    performance: form.performance,
    risk: form.risk,
  });

  const area = (label: string, key: keyof typeof form) => (
    <Field label={label}>
      <Textarea rows={2} value={form[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<typeof form>)} />
    </Field>
  );

  return (
    <div className="space-y-4">
      <Section title="Impact Analysis">
        <Field label="Affected Module"><EntitySelect source="module" value={form.affectedModule} onChange={(v) => set({ affectedModule: v })} /></Field>
        <Field label="Complexity"><OptionSelect listKey="complexity" value={form.complexity} onChange={(v) => set({ complexity: v })} /></Field>
        <Field label="Estimated Hours">
          <Input type="number" min="0" step="0.5" value={form.estimatedHours} onChange={(e) => set({ estimatedHours: e.target.value })} />
        </Field>
        <div className="hidden sm:block" />
        {area('Affected Tables', 'affectedTables')}
        {area('Reports', 'impactReports')}
        {area('Interfaces', 'impactInterfaces')}
        {area('Forms', 'impactForms')}
        {area('Workflow', 'impactWorkflow')}
        {area('Master Data', 'masterData')}
        {area('Authorizations', 'authorizations')}
        {area('Performance', 'performance')}
        {area('Risk', 'risk')}
      </Section>

      <div className="flex justify-end">
        <Button disabled={saver.isPending} onClick={save}>
          {saver.isPending ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
