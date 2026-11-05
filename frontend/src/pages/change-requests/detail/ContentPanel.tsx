import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OptionSelect, EntitySelect } from '../OptionSelect';
import { crOptionsQuery, type ChangeRequest } from '../changeRequestMeta';
import { Field } from './section';

// The change's own details — what it is, who it's for, who owns it. They belong
// to the record rather than to any one stage, so they stay on screen (and stay
// editable) whichever stage is open on the right.
const seed = (cr: ChangeRequest) => ({
  changeSource: cr.changeSource === 'INTERNAL' ? 'INTERNAL' : 'CUSTOMER',
  title: cr.title ?? '',
  description: cr.description ?? '',
  reasonForCr: cr.reasonForCr ?? '',
  customerCompanyId: cr.customerCompanyId ?? '',
  customer: cr.customer ?? '',
  changeGroup: cr.changeGroup ?? '',
  changeType: cr.changeType ?? '',
  crCategory: cr.crCategory ?? '',
  subCategory: cr.subCategory ?? '',
  priority: cr.priority ?? '',
  requestedBy: cr.requestedBy ?? '',
  changeCoordinator: cr.changeCoordinator ?? '',
  changeOwner: cr.changeOwner ?? '',
  comments: cr.comments ?? '',
});

export default function ContentPanel({ cr }: { cr: ChangeRequest }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => seed(cr));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Key the re-hydrate on the saved content, not the query's object identity —
  // a refetch on window focus hands back a new object and would wipe typing.
  const savedKey = JSON.stringify(seed(cr));
  useEffect(() => { setForm(seed(cr)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });
  const { data: subOptions = [] } = useQuery(crOptionsQuery('subcategory'));
  const hasSub = subOptions.some((o) => o.isActive && (o.parentValue ?? '') === form.crCategory);

  const internal = form.changeSource === 'INTERNAL';

  const save = useMutation({
    mutationFn: () => api.patch(`/api/change-requests/${cr.id}`, {
      changeSource: form.changeSource,
      title: form.title,
      description: form.description,
      reasonForCr: form.reasonForCr,
      ...(internal ? {} : { customerCompanyId: form.customerCompanyId || null, customer: form.customer }),
      changeGroup: form.changeGroup,
      changeType: form.changeType,
      crCategory: form.crCategory,
      subCategory: form.subCategory,
      priority: form.priority,
      requestedBy: form.requestedBy,
      changeCoordinator: form.changeCoordinator,
      changeOwner: form.changeOwner,
      comments: form.comments,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['change-requests'] }); toast.success('Details saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not save'),
  });

  return (
    <div className="overflow-hidden rounded-xl border">
      {/* Save sits in the header rather than a footer, so it is reachable without
          scrolling past the whole form. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Details</span>
          <span className="truncate text-xs text-muted-foreground">Applies to every stage</span>
        </div>
        <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="space-y-4 p-4">
        {/* Title shares its row with the Customer / Internal choice, so the title
            field is narrowed to leave room for it. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Title"><Input value={form.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          </div>
          <div className="sm:w-52 sm:shrink-0">
            <Field label="Raised for">
              {/* RadioGroupItem fires on every click, the selected one included —
                  ignore the no-op so the customer link isn't cleared needlessly. */}
              <RadioGroup
                value={form.changeSource}
                onValueChange={(v) => {
                  if (v === form.changeSource) return;
                  set(v === 'INTERNAL' ? { changeSource: v, customerCompanyId: '', customer: '' } : { changeSource: v });
                }}
                className="flex h-9 items-center gap-4"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="CUSTOMER" /> Customer</label>
                <label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="INTERNAL" /> Internal</label>
              </RadioGroup>
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Description" className="sm:col-span-2"><Textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Reason for the change" className="sm:col-span-2"><Textarea rows={2} value={form.reasonForCr} onChange={(e) => set({ reasonForCr: e.target.value })} /></Field>
          {!internal && (
            <Field label="Customer name">
              <Select value={form.customerCompanyId || undefined} onValueChange={(v) => { if (v) set({ customerCompanyId: v, customer: companies.find((c) => c.id === v)?.name ?? '' }); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select the customer" /></SelectTrigger>
                <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Change Group"><OptionSelect listKey="change_group" value={form.changeGroup} onChange={(v) => set({ changeGroup: v })} /></Field>
          <Field label="Change Type"><OptionSelect listKey="change_type" value={form.changeType} onChange={(v) => set({ changeType: v })} placeholder="Select a change type" /></Field>
          <Field label="Priority"><OptionSelect listKey="priority" value={form.priority} onChange={(v) => set({ priority: v })} /></Field>
          <Field label="Category"><OptionSelect listKey="category" value={form.crCategory} onChange={(v) => set({ crCategory: v, subCategory: '' })} /></Field>
          {hasSub && <Field label="Sub Category"><OptionSelect listKey="subcategory" parent={form.crCategory} value={form.subCategory} onChange={(v) => set({ subCategory: v })} /></Field>}
          <Field label="Change Requestor"><EntitySelect source="person" value={form.requestedBy} onChange={(v) => set({ requestedBy: v })} /></Field>
          <Field label="Change Co-Ordinator"><EntitySelect source="person" value={form.changeCoordinator} onChange={(v) => set({ changeCoordinator: v })} /></Field>
          <Field label="Change Owner"><EntitySelect source="person" value={form.changeOwner} onChange={(v) => set({ changeOwner: v })} /></Field>
          <Field label="Comments" className="sm:col-span-2"><Textarea rows={2} value={form.comments} onChange={(e) => set({ comments: e.target.value })} /></Field>
        </div>
      </div>
    </div>
  );
}
