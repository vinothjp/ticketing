import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { OptionSelect } from '../OptionSelect';
import { type ChangeRequest } from '../changeRequestMeta';
import { Field, Section, useCrSaver } from './section';
import CrAttachments from './CrAttachments';

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const fromCr = (cr: ChangeRequest) => ({
  testCase: cr.testCase ?? '',
  testingPerson: cr.testingPerson ?? '',
  testingStatus: cr.testingStatus ?? '',
  uatPerformedBy: cr.uatPerformedBy ?? '',
  defectCount: str(cr.defectCount),
  retest: cr.retest ?? '',
  testApproval: cr.testApproval ?? '',
});

export default function TestingTab({ cr }: { cr: ChangeRequest }) {
  const [form, setForm] = useState(() => fromCr(cr));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => { setForm(fromCr(cr)); }, [cr.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saver = useCrSaver(cr.id);
  const save = () => saver.mutate({
    testCase: form.testCase,
    testingPerson: form.testingPerson,
    testingStatus: form.testingStatus,
    uatPerformedBy: form.uatPerformedBy,
    defectCount: form.defectCount.trim() ? Number(form.defectCount) : null,
    retest: form.retest,
    testApproval: form.testApproval,
  });

  return (
    <div className="space-y-4">
      <Section title="Testing">
        <Field label="Test Case" className="sm:col-span-2"><Textarea rows={2} value={form.testCase} onChange={(e) => set({ testCase: e.target.value })} /></Field>
        <Field label="Testing Person"><OptionSelect listKey="person" value={form.testingPerson} onChange={(v) => set({ testingPerson: v })} /></Field>
        <Field label="Testing Status"><OptionSelect listKey="test_status" value={form.testingStatus} onChange={(v) => set({ testingStatus: v })} /></Field>
        <Field label="UAT Performed By"><OptionSelect listKey="person" value={form.uatPerformedBy} onChange={(v) => set({ uatPerformedBy: v })} /></Field>
        <Field label="Defect Count"><Input type="number" min="0" step="1" value={form.defectCount} onChange={(e) => set({ defectCount: e.target.value })} /></Field>
        <Field label="Retest"><OptionSelect listKey="yes_no" value={form.retest} onChange={(v) => set({ retest: v })} /></Field>
        <Field label="Approval"><OptionSelect listKey="approval" value={form.testApproval} onChange={(v) => set({ testApproval: v })} /></Field>
      </Section>

      <div className="flex justify-end">
        <Button disabled={saver.isPending} onClick={save}>
          {saver.isPending ? 'Saving...' : 'Save changes'}
        </Button>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">UAT Document</h2>
        <p className="mb-3 text-xs text-muted-foreground">Attach the UAT sign-off document (upload a file or paste a link).</p>
        <CrAttachments crId={cr.id} entityType="uat" />
      </section>
    </div>
  );
}
