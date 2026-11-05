import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { type ChangeRequest } from '../changeRequestMeta';
import { Field, Section, useCrSaver } from './section';

const fromCr = (cr: ChangeRequest) => ({
  requirementDetails: cr.requirementDetails ?? '',
  objective: cr.objective ?? '',
  reasonForCr: cr.reasonForCr ?? '',
  benefitToCustomer: cr.benefitToCustomer ?? '',
});

export default function BusinessRequirementTab({ cr }: { cr: ChangeRequest }) {
  const [form, setForm] = useState(() => fromCr(cr));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => { setForm(fromCr(cr)); }, [cr.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saver = useCrSaver(cr.id);

  return (
    <div className="space-y-4">
      <Section title="Business Requirement" cols={1}>
        <Field label="Requirement Details">
          <Textarea rows={4} value={form.requirementDetails} onChange={(e) => set({ requirementDetails: e.target.value })} />
        </Field>
        <Field label="Objective">
          <Textarea rows={3} value={form.objective} onChange={(e) => set({ objective: e.target.value })} />
        </Field>
        <Field label="Reason for the CR">
          <Textarea rows={3} value={form.reasonForCr} onChange={(e) => set({ reasonForCr: e.target.value })} />
        </Field>
        <Field label="Benefit to Customer">
          <Textarea rows={3} value={form.benefitToCustomer} onChange={(e) => set({ benefitToCustomer: e.target.value })} />
        </Field>
      </Section>

      <div className="flex justify-end">
        <Button disabled={saver.isPending} onClick={() => saver.mutate(form)}>
          {saver.isPending ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
