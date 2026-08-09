import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DateField } from '@/components/ui/date-field';
import { OptionSelect } from '../OptionSelect';
import { dateVal, type ChangeRequest } from '../changeRequestMeta';
import { Field, Section, useCrSaver } from './section';
import CrAttachments from './CrAttachments';

const fromCr = (cr: ChangeRequest) => ({
  blueprintName: cr.blueprintName ?? '',
  blueprintVersionNumber: cr.blueprintVersionNumber ?? '',
  blueprintPreparedBy: cr.blueprintPreparedBy ?? '',
  blueprintReviewedBy: cr.blueprintReviewedBy ?? '',
  blueprintApprovedBy: cr.blueprintApprovedBy ?? '',
  blueprintApprovalDate: dateVal(cr.blueprintApprovalDate),
  blueprintRemarks: cr.blueprintRemarks ?? '',
});

export default function BluePrintTab({ cr }: { cr: ChangeRequest }) {
  const [form, setForm] = useState(() => fromCr(cr));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => { setForm(fromCr(cr)); }, [cr.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saver = useCrSaver(cr.id);
  const save = () => saver.mutate({
    blueprintName: form.blueprintName,
    blueprintVersionNumber: form.blueprintVersionNumber,
    blueprintPreparedBy: form.blueprintPreparedBy,
    blueprintReviewedBy: form.blueprintReviewedBy,
    blueprintApprovedBy: form.blueprintApprovedBy,
    blueprintApprovalDate: form.blueprintApprovalDate || null,
    blueprintRemarks: form.blueprintRemarks,
  });

  return (
    <div className="space-y-4">
      <Section title="Blue Print">
        <Field label="Blue Print Name"><Input value={form.blueprintName} onChange={(e) => set({ blueprintName: e.target.value })} placeholder="e.g. BBP Version1, Signed Blueprint" /></Field>
        <Field label="Version Number"><Input value={form.blueprintVersionNumber} onChange={(e) => set({ blueprintVersionNumber: e.target.value })} /></Field>
        <Field label="Prepared By"><OptionSelect listKey="person" value={form.blueprintPreparedBy} onChange={(v) => set({ blueprintPreparedBy: v })} /></Field>
        <Field label="Reviewed By"><OptionSelect listKey="person" value={form.blueprintReviewedBy} onChange={(v) => set({ blueprintReviewedBy: v })} /></Field>
        <Field label="Approved By"><OptionSelect listKey="person" value={form.blueprintApprovedBy} onChange={(v) => set({ blueprintApprovedBy: v })} /></Field>
        <Field label="Approval Date"><DateField value={form.blueprintApprovalDate} onChange={(v) => set({ blueprintApprovalDate: v })} /></Field>
        <Field label="Remarks" className="sm:col-span-2"><Textarea rows={3} value={form.blueprintRemarks} onChange={(e) => set({ blueprintRemarks: e.target.value })} /></Field>
      </Section>

      <div className="flex justify-end">
        <Button disabled={saver.isPending} onClick={save}>
          {saver.isPending ? 'Saving...' : 'Save changes'}
        </Button>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Doc Attachment</h2>
        <p className="mb-3 text-xs text-muted-foreground">Attach the blueprint document (upload a file or paste a link).</p>
        <CrAttachments crId={cr.id} entityType="blueprint" />
      </section>
    </div>
  );
}
