import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DateField } from '@/components/ui/date-field';
import { OptionSelect } from '../OptionSelect';
import { dateVal, type ChangeRequest } from '../changeRequestMeta';
import { Field, Section, useCrSaver } from './section';

const fromCr = (cr: ChangeRequest) => ({
  title: cr.title ?? '',
  description: cr.description ?? '',
  featureName: cr.featureName ?? '',
  customer: cr.customer ?? '',
  projectName: cr.projectName ?? '',
  moduleName: cr.moduleName ?? '',
  crType: cr.crType ?? '',
  priority: cr.priority ?? '',
  crCategory: cr.crCategory ?? '',
  status: cr.status ?? '',
  requestedBy: cr.requestedBy ?? '',
  businessOwner: cr.businessOwner ?? '',
  functionalConsultant: cr.functionalConsultant ?? '',
  technicalConsultant: cr.technicalConsultant ?? '',
  projectManager: cr.projectManager ?? '',
  crDate: dateVal(cr.crDate),
  crStartDate: dateVal(cr.crStartDate),
  crEndDate: dateVal(cr.crEndDate),
  targetReleaseDate: dateVal(cr.targetReleaseDate),
  expectedGoLiveDate: dateVal(cr.expectedGoLiveDate),
});

export default function GeneralTab({ cr }: { cr: ChangeRequest }) {
  const [form, setForm] = useState(() => fromCr(cr));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Re-sync when switching to a different CR record.
  useEffect(() => { setForm(fromCr(cr)); }, [cr.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saver = useCrSaver(cr.id);
  const save = () => saver.mutate({
    title: form.title.trim(),
    description: form.description,
    featureName: form.featureName,
    customer: form.customer,
    projectName: form.projectName,
    moduleName: form.moduleName,
    crType: form.crType,
    priority: form.priority,
    crCategory: form.crCategory,
    status: form.status || 'New',
    requestedBy: form.requestedBy,
    businessOwner: form.businessOwner,
    functionalConsultant: form.functionalConsultant,
    technicalConsultant: form.technicalConsultant,
    projectManager: form.projectManager,
    crDate: form.crDate || null,
    crStartDate: form.crStartDate || null,
    crEndDate: form.crEndDate || null,
    targetReleaseDate: form.targetReleaseDate || null,
    expectedGoLiveDate: form.expectedGoLiveDate || null,
  });

  return (
    <div className="space-y-4">
      <Section title="General">
        <Field label="Title" className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="Customer"><OptionSelect listKey="customer" value={form.customer} onChange={(v) => set({ customer: v })} /></Field>
        <Field label="Project Name"><OptionSelect listKey="project" value={form.projectName} onChange={(v) => set({ projectName: v })} /></Field>
        <Field label="Module Name"><OptionSelect listKey="module" value={form.moduleName} onChange={(v) => set({ moduleName: v })} /></Field>
        <Field label="Feature Name (Menu)"><Input value={form.featureName} onChange={(e) => set({ featureName: e.target.value })} /></Field>
        <Field label="Priority"><OptionSelect listKey="priority" value={form.priority} onChange={(v) => set({ priority: v })} /></Field>
        <Field label="CR Type"><OptionSelect listKey="type" value={form.crType} onChange={(v) => set({ crType: v })} /></Field>
        <Field label="CR Category"><OptionSelect listKey="category" value={form.crCategory} onChange={(v) => set({ crCategory: v })} /></Field>
        <Field label="Status"><OptionSelect listKey="status" value={form.status} onChange={(v) => set({ status: v })} placeholder="New" /></Field>
      </Section>

      <Section title="People">
        <Field label="Requested By"><OptionSelect listKey="person" value={form.requestedBy} onChange={(v) => set({ requestedBy: v })} /></Field>
        <Field label="Business Owner"><OptionSelect listKey="person" value={form.businessOwner} onChange={(v) => set({ businessOwner: v })} /></Field>
        <Field label="Functional Consultant"><OptionSelect listKey="person" value={form.functionalConsultant} onChange={(v) => set({ functionalConsultant: v })} /></Field>
        <Field label="Technical Consultant"><OptionSelect listKey="person" value={form.technicalConsultant} onChange={(v) => set({ technicalConsultant: v })} /></Field>
        <Field label="Project Manager"><OptionSelect listKey="person" value={form.projectManager} onChange={(v) => set({ projectManager: v })} /></Field>
      </Section>

      <Section title="Schedule">
        <Field label="CR Date"><DateField value={form.crDate} onChange={(v) => set({ crDate: v })} /></Field>
        <div className="hidden sm:block" />
        <Field label="CR Start Date"><DateField value={form.crStartDate} onChange={(v) => set({ crStartDate: v })} /></Field>
        <Field label="CR End Date"><DateField value={form.crEndDate} onChange={(v) => set({ crEndDate: v })} min={form.crStartDate || undefined} /></Field>
        <Field label="Target Release Date"><DateField value={form.targetReleaseDate} onChange={(v) => set({ targetReleaseDate: v })} min={form.crEndDate || undefined} /></Field>
        <Field label="Expected Go Live Date"><DateField value={form.expectedGoLiveDate} onChange={(v) => set({ expectedGoLiveDate: v })} min={form.targetReleaseDate || undefined} /></Field>
      </Section>

      <div className="flex justify-end">
        <Button disabled={!form.title.trim() || saver.isPending} onClick={save}>
          {saver.isPending ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
