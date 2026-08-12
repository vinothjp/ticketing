import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, CalendarDays, Users, Pencil, X, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/hooks/useConfirm';
import { invalidateProject, type ProjectDetail, type UserOption } from '../projectMeta';

interface ActionItem { text: string; owner?: string; done?: boolean }
interface Meeting { id: string; title: string; date?: string | null; attendees?: string | null; notes?: string | null; actionItems: ActionItem[] }
interface CustomerContact { id: string; username: string; email: string; role: 'admin' | 'employee' }

const NONE = '__none__';
const toDate = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const splitAttendees = (v?: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

type FormState = {
  id: string | null;
  title: string;
  date: string;
  attendees: string[];
  notes: string;
  actionItems: ActionItem[];
};
const emptyForm = (): FormState => ({
  id: null, title: '', date: new Date().toISOString().slice(0, 10), attendees: [], notes: '', actionItems: [],
});

export default function MeetingsTab({ project, users }: { project: ProjectDetail; users: UserOption[] }) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const key = ['projects', project.id, 'registers', 'meetings'];
  const invalidate = () => invalidateProject(qc);

  const { data: meetings = [] } = useQuery<Meeting[]>({
    queryKey: key,
    queryFn: async () => (await api.get(`/api/projects/${project.id}/registers/meetings`)).data,
  });

  // Customer-company people (admin + employees) linked to this project — eligible
  // to be invited alongside the internal team. Empty when no company is linked.
  const { data: customerContacts = [] } = useQuery<CustomerContact[]>({
    queryKey: ['projects', project.id, 'customer-contacts'],
    queryFn: async () => (await api.get(`/api/projects/${project.id}/customer-contacts`)).data,
    enabled: !!project.customerCompanyId,
  });

  const usernameById = useMemo(() => new Map(users.map((u) => [u.id, u.username])), [users]);

  const payload = (f: FormState) => ({
    title: f.title.trim(),
    date: f.date,
    attendees: f.attendees.join(', '),
    notes: f.notes,
    actionItems: f.actionItems.map((a) => ({ text: a.text.trim(), owner: a.owner || undefined, done: !!a.done })).filter((a) => a.text),
  });

  const save = useMutation({
    mutationFn: (f: FormState) => f.id
      ? api.patch(`/api/projects/registers/meetings/${f.id}`, payload(f))
      : api.post(`/api/projects/${project.id}/registers/meetings`, payload(f)),
    onSuccess: (_r, f) => { invalidate(); setOpen(false); toast.success(f.id ? 'Meeting updated' : 'Meeting added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const patch = useMutation({
    mutationFn: ({ id, actionItems }: { id: string; actionItems: ActionItem[] }) => api.patch(`/api/projects/registers/meetings/${id}`, { actionItems }),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/registers/meetings/${id}`),
    onSuccess: () => { invalidate(); toast.success('Meeting removed'); },
  });

  const openNew = () => { setForm(emptyForm()); setOpen(true); };
  const openEdit = (m: Meeting) => {
    setForm({
      id: m.id, title: m.title, date: toDate(m.date), attendees: splitAttendees(m.attendees),
      notes: m.notes ?? '', actionItems: (m.actionItems ?? []).map((a) => ({ ...a })),
    });
    setOpen(true);
  };

  // Toggle a done checkbox directly on a saved card (quick action, no dialog).
  const toggleAction = (m: Meeting, idx: number) => {
    const next = m.actionItems.map((a, i) => (i === idx ? { ...a, done: !a.done } : a));
    patch.mutate({ id: m.id, actionItems: next });
  };

  // ---- action-item row editing (within the dialog) ----
  const addRow = () => setForm((f) => ({ ...f, actionItems: [...f.actionItems, { text: '', owner: '', done: false }] }));
  const updateRow = (i: number, patch: Partial<ActionItem>) =>
    setForm((f) => ({ ...f, actionItems: f.actionItems.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) }));
  const removeRow = (i: number) => setForm((f) => ({ ...f, actionItems: f.actionItems.filter((_, idx) => idx !== i) }));
  const toggleAttendee = (username: string) =>
    setForm((f) => ({ ...f, attendees: f.attendees.includes(username) ? f.attendees.filter((a) => a !== username) : [...f.attendees, username] }));

  return (
    <div className="space-y-4">
      {ConfirmDialog}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{meetings.length} meeting{meetings.length === 1 ? '' : 's'} · minutes of meeting</span>
        <Button size="sm" onClick={openNew}><Plus className="size-4" /> Add Meeting</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? 'Edit meeting' : 'New meeting'} — minutes of meeting</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <div className="mb-1 text-sm font-medium">Title</div>
                <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Sprint 3 planning" />
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">Date</div>
                <DateField value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} />
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Attendees</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-start font-normal">
                    <Users className="size-4" />
                    {form.attendees.length ? `${form.attendees.length} selected` : 'Select attendees'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-64 w-72 overflow-y-auto">
                  <DropdownMenuLabel>Team (internal)</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {users.map((u) => (
                    <DropdownMenuCheckboxItem
                      key={u.id}
                      checked={form.attendees.includes(u.username)}
                      onCheckedChange={() => toggleAttendee(u.username)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {u.username}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {/* Customer-side attendees — only the company linked to this project. */}
                  {customerContacts.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Customer — {project.customerCompany?.name ?? 'company'}</DropdownMenuLabel>
                      {customerContacts.map((c) => (
                        <DropdownMenuCheckboxItem
                          key={c.id}
                          checked={form.attendees.includes(c.username)}
                          onCheckedChange={() => toggleAttendee(c.username)}
                          onSelect={(e) => e.preventDefault()}
                        >
                          {c.username}
                          <span className="ml-1 text-xs text-muted-foreground">({c.role})</span>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </>
                  )}
                  {users.length === 0 && customerContacts.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No one available to invite.</div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {!project.customerCompanyId && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Link a customer company in project Settings to invite its admin or employees.
                </p>
              )}
              {form.attendees.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {form.attendees.map((a) => (
                    <Badge key={a} variant="secondary" className="gap-1">
                      {a}
                      <button type="button" onClick={() => toggleAttendee(a)} className="hover:text-destructive"><X className="size-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 text-sm font-medium">Notes / discussion</div>
              <Textarea rows={4} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Key discussion points, decisions…" />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium">Action items</span>
                <Button type="button" size="sm" variant="outline" onClick={addRow}><Plus className="size-3.5" /> Add action item</Button>
              </div>
              <div className="space-y-2">
                {form.actionItems.length === 0 && <p className="text-xs text-muted-foreground">No action items yet.</p>}
                {form.actionItems.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Checkbox checked={!!a.done} onCheckedChange={(v) => updateRow(i, { done: !!v })} />
                    <Input className="flex-1" value={a.text} onChange={(e) => updateRow(i, { text: e.target.value })} placeholder="Action item…" />
                    <Select value={a.owner || NONE} onValueChange={(v) => updateRow(i, { owner: v === NONE ? '' : v })}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="Owner" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No owner</SelectItem>
                        {users.map((u) => <SelectItem key={u.id} value={u.username}>{u.username}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" onClick={() => removeRow(i)}><X className="size-4" /></Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!form.title.trim() || save.isPending} onClick={() => save.mutate(form)}>
              {save.isPending ? 'Saving…' : form.id ? 'Save changes' : 'Add meeting'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {meetings.length === 0 && <p className="text-sm text-muted-foreground">No meetings recorded yet.</p>}
      <div className="space-y-4">
        {meetings.map((m) => {
          const attendees = splitAttendees(m.attendees);
          const done = m.actionItems?.filter((a) => a.done).length ?? 0;
          return (
            <Card key={m.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                      <CalendarDays className="size-4 shrink-0 text-primary" /> {m.title}
                    </div>
                    <div className="text-xs text-muted-foreground">{m.date ? new Date(m.date).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : 'No date'}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" className="size-7" onClick={() => openEdit(m)}><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" className="size-7 text-destructive hover:text-destructive"
                      onClick={async () => { if (await confirm({ title: 'Delete meeting?', destructive: true, confirmText: 'Delete' })) del.mutate(m.id); }}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {attendees.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Users className="size-3.5 text-muted-foreground" />
                    {attendees.map((a) => <Badge key={a} variant="outline">{a}</Badge>)}
                  </div>
                )}

                {m.notes && <p className="whitespace-pre-wrap text-sm text-foreground">{m.notes}</p>}

                {m.actionItems?.length > 0 && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <ClipboardList className="size-3.5" /> Action items · {done}/{m.actionItems.length} done
                    </div>
                    <div className="space-y-1">
                      {m.actionItems.map((a, i) => (
                        <label key={i} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={!!a.done} onCheckedChange={() => toggleAction(m, i)} />
                          <span className={a.done ? 'text-muted-foreground line-through' : ''}>{a.text}</span>
                          {a.owner && <Badge variant="secondary" className="ml-auto">{usernameById.get(a.owner) ?? a.owner}</Badge>}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
