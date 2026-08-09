import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/ui/date-field';
import { OptionSelect } from '../OptionSelect';
import { dateVal, type ChangeRequest } from '../changeRequestMeta';
import { Field, Section, useCrSaver } from './section';

const fromCr = (cr: ChangeRequest) => ({
  developer: cr.developer ?? '',
  developmentStatus: cr.developmentStatus ?? '',
  developmentStartDate: dateVal(cr.developmentStartDate),
  completionDate: dateVal(cr.completionDate),
  transportNumber: cr.transportNumber ?? '',
  gitRepository: cr.gitRepository ?? '',
  buildNumber: cr.buildNumber ?? '',
});

export default function DevelopmentTab({ cr }: { cr: ChangeRequest }) {
  const [form, setForm] = useState(() => fromCr(cr));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => { setForm(fromCr(cr)); }, [cr.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saver = useCrSaver(cr.id);
  const save = () => saver.mutate({
    developer: form.developer,
    developmentStatus: form.developmentStatus,
    developmentStartDate: form.developmentStartDate || null,
    completionDate: form.completionDate || null,
    transportNumber: form.transportNumber,
    gitRepository: form.gitRepository,
    buildNumber: form.buildNumber,
  });

  return (
    <div className="space-y-4">
      <Section title="Development Details">
        <Field label="Developer"><OptionSelect listKey="person" value={form.developer} onChange={(v) => set({ developer: v })} /></Field>
        <Field label="Development Status"><OptionSelect listKey="dev_status" value={form.developmentStatus} onChange={(v) => set({ developmentStatus: v })} /></Field>
        <Field label="Development Start"><DateField value={form.developmentStartDate} onChange={(v) => set({ developmentStartDate: v })} /></Field>
        <Field label="Completion Date"><DateField value={form.completionDate} onChange={(v) => set({ completionDate: v })} min={form.developmentStartDate || undefined} /></Field>
        <Field label="Transport Number"><Input value={form.transportNumber} onChange={(e) => set({ transportNumber: e.target.value })} /></Field>
        <Field label="Git Repository"><Input value={form.gitRepository} onChange={(e) => set({ gitRepository: e.target.value })} placeholder="e.g. org/repo or URL" /></Field>
        <Field label="Build Number"><Input value={form.buildNumber} onChange={(e) => set({ buildNumber: e.target.value })} /></Field>
      </Section>

      <div className="flex justify-end">
        <Button disabled={saver.isPending} onClick={save}>
          {saver.isPending ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
