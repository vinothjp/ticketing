import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Building2, Boxes, Search, Upload, ShieldCheck, Unlink,
  Hash, AtSign, Mail, Phone, FileText, MessageSquare, CircleDot } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import CompanyLogo from '@/components/CompanyLogo';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '../context/AuthContext';
import ImportExportBar from '@/components/ImportExportBar';
import type { ReactNode } from 'react';
import { MyExcessApprovals } from '@/components/MyExcessApprovals';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * A column heading: its icon, then its label. Muted and small, so the headings
 * read as chrome and the values below them carry the weight. Mirrors the task
 * grid on the ticket detail screen.
 */
function HeadLabel({ icon: Icon, children, className = '' }: {
  icon: LucideIcon; children: ReactNode; className?: string;
}) {
  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground ${className}`}>
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

interface Company {
  id: string;
  name: string;
  code?: string | null;
  contactEmail?: string | null;
  contactPerson?: string | null;
  contactNumber?: string | null;
  logoUrl?: string | null;
  status: string;
  maxContacts: number;
  ticketCount: number;
  contractScope?: 'PRODUCT' | 'CUSTOMER';
}
interface Contact { id: string; username: string; name?: string | null; email: string; isActive: boolean; isAdmin: boolean; }
interface AdminUser { id: string; username: string; name?: string | null; email: string; }

/**
 * The client's one customer admin, as the form holds it: a new login to create,
 * or an existing unlinked CustomerAdmin to link. Required on New Client.
 */
interface AdminInput { mode: 'new' | 'link'; username: string; email: string; password: string; userId: string; }
const emptyAdmin: AdminInput = { mode: 'new', username: '', email: '', password: '', userId: '' };

const adminValid = (a: AdminInput) =>
  a.mode === 'link' ? !!a.userId : !!(a.username.trim() && a.email.trim() && a.password.length >= 6);

const displayName = (u: { name?: string | null; username: string }) => u.name?.trim() || u.username;

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const empty = {
  name: '', code: '', contactEmail: '', contactPerson: '', contactNumber: '', maxContacts: 5,
};

export default function CustomerCompaniesPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);
  const [admin, setAdmin] = useState<AdminInput>(emptyAdmin);
  const [q, setQ] = useState('');
  // A new client has no id yet, so its logo is held here and uploaded once the
  // company exists. `pendingPreview` is an object URL we must revoke.
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['customer-companies'] });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(term) || (c.code ?? '').toLowerCase().includes(term));
  }, [companies, q]);

  // The edited client, re-read from the list so the logo refreshes after upload.
  const current = editing ? companies.find((c) => c.id === editing.id) ?? editing : null;

  useEffect(() => () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview); }, [pendingPreview]);

  // The effect above revokes whatever URL we drop here.
  const clearPending = () => { setPendingLogo(null); setPendingPreview(null); };

  const uploadLogo = (companyId: string, file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return api.post(`/api/customer-companies/${companyId}/logo`, formData);
  };

  const saveMutation = useMutation({
    mutationFn: async (c: typeof form) => {
      const body: Record<string, unknown> = {
        name: c.name, code: c.code || undefined, contactEmail: c.contactEmail || undefined,
        contactPerson: c.contactPerson || undefined, contactNumber: c.contactNumber || undefined,
        maxContacts: Number(c.maxContacts),
      };
      if (editing) return api.patch(`/api/customer-companies/${editing.id}`, body);
      // The customer admin rides on the create — linked or new, never neither.
      if (admin.mode === 'link') body.adminUserId = admin.userId;
      else Object.assign(body, { adminUsername: admin.username.trim(), adminEmail: admin.email.trim(), adminPassword: admin.password });
      const created = await api.post('/api/customer-companies', body);
      // The logo needs the new id, so it goes up right after the company lands.
      if (pendingLogo) await uploadLogo(created.data.id, pendingLogo);
      return created;
    },
    onSuccess: () => {
      invalidate();
      if (!editing) qc.invalidateQueries({ queryKey: ['available-admins'] });
      closeForm();
      toast.success(editing ? 'Company updated' : 'Company created');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving company'),
  });

  const logoMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File | null }) =>
      file ? uploadLogo(id, file) : api.delete(`/api/customer-companies/${id}/logo`),
    onSuccess: (_d, v) => { invalidate(); toast.success(v.file ? 'Logo updated' : 'Logo removed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving logo'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/customer-companies/${id}`),
    onSuccess: () => { invalidate(); toast.success('Company deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting company'),
  });

  const onPickLogo = (file?: File) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Choose an image file'); return; }
    if (file.size > MAX_LOGO_BYTES) { toast.error('Logo must be under 2 MB'); return; }
    if (editing) { logoMutation.mutate({ id: editing.id, file }); return; }
    clearPending();
    setPendingLogo(file);
    setPendingPreview(URL.createObjectURL(file));
  };

  const removeLogo = () => {
    if (editing) logoMutation.mutate({ id: editing.id, file: null });
    else clearPending();
  };

  const closeForm = () => { setFormOpen(false); setEditing(null); clearPending(); };
  const openCreate = () => { setEditing(null); setForm(empty); setAdmin(emptyAdmin); clearPending(); setFormOpen(true); };
  const openEdit = (c: Company) => {
    setEditing(c);
    setAdmin(emptyAdmin);
    clearPending();
    setForm({
      ...empty, name: c.name, code: c.code ?? '', contactEmail: c.contactEmail ?? '',
      contactPerson: c.contactPerson ?? '', contactNumber: c.contactNumber ?? '', maxContacts: c.maxContacts,
    });
    setFormOpen(true);
  };

  const hasLogo = editing ? !!current?.logoUrl : !!pendingPreview;

  return (
    <div>
      <div className="mb-4 min-w-0">
        <h1 className="text-2xl font-bold text-foreground">Clients</h1>
        <p className="text-sm text-muted-foreground">External clients whose contacts can log in and raise tickets.</p>
      </div>

      {/* Search and every action on one row, the shape both masters use. The
          import/export trio is Admin-only: the sheet carries contact detail, and
          posting one back adds and edits clients. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-8" />
        </div>
        {isAdmin && (
          <>
            <ImportExportBar
              noun="clients"
              templateName="client-import-template.xlsx"
              exportUrl="/api/customer-companies/export"
              templateUrl="/api/customer-companies/import-template"
              importUrl="/api/customer-companies/import"
              onImported={() => qc.invalidateQueries({ queryKey: ['customer-companies'] })}
            />
            <Button onClick={openCreate}><Plus className="size-4" /> New Client</Button>
          </>
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={(o) => (o ? setFormOpen(true) : closeForm())}>
        <DialogContent className="flex max-h-[90vh] flex-col">
          <DialogHeader><DialogTitle>{editing ? 'Edit Client' : 'New Client'}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="flex items-center gap-4">
              <CompanyLogo logoUrl={pendingPreview ?? current?.logoUrl} className="size-16" />
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Logo <span className="font-normal text-muted-foreground">(optional)</span></label>
                <div className="flex items-center gap-2">
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted">
                    <Upload className="size-3.5" /> {hasLogo ? 'Change image' : 'Upload image'}
                    <input ref={fileRef} type="file" accept="image/*" className="hidden"
                      onChange={(e) => onPickLogo(e.target.files?.[0])} />
                  </label>
                  {hasLogo && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={removeLogo}>Remove</Button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Company name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Globex Ltd" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Code</label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="GLX" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Max contacts</label>
                <Input type="number" min={1} max={50} value={form.maxContacts} onChange={(e) => setForm({ ...form, maxContacts: Number(e.target.value) })} />
              </div>
            </div>

            {/* The client's one customer admin, right under its identity: required
                on create; on edit, set here once if the client has none. */}
            {editing
              ? <CustomerAdminSection companyId={editing.id} />
              : (
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <div className="text-sm font-medium">Customer admin <span className="text-destructive">*</span></div>
                  <p className="text-xs text-muted-foreground">
                    The client’s login. They manage their own team after this — you won’t add users here.
                  </p>
                  <CustomerAdminFields value={admin} onChange={setAdmin} />
                </div>
              )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Contact email</label>
              <Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="ops@globex.example" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Contact person</label>
                <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="e.g. Priya Nair" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Contact number</label>
                <Input value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} placeholder="e.g. +91 98765 43210" />
              </div>
            </div>

            {editing && (
              <>
                <Button variant="outline" className="w-full" onClick={() => { const id = editing.id; closeForm(); navigate(`/admin/clients/${id}`); }}>
                  <Boxes className="size-4" /> Products &amp; consultants
                </Button>
                <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Products, warranty, AMC and default consultants are managed there.
                </p>
                <ContactsSection companyId={editing.id} maxContacts={form.maxContacts} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name.trim() || (!editing && !adminValid(admin)) || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* What is waiting on this user, wherever it lives — an approver should not
          have to guess which client raised the request. */}
      <MyExcessApprovals />

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Building2 className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{companies.length === 0 ? 'No clients yet.' : 'No clients match your search.'}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="border-r"><HeadLabel icon={Building2}>Client</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Hash}>Code</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={AtSign}>Contact</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Mail}>Email</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Phone}>Phone</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={FileText}>Contract</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={MessageSquare} className="justify-end">Tickets</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={CircleDot}>Status</HeadLabel></TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  {/* The wide text columns cap their own width and ellipsize, so a long
                      name or address can't push the table into a horizontal scroll. */}
                  <TableCell className="border-r font-medium">
                    <span className="flex items-center gap-2">
                      <CompanyLogo logoUrl={c.logoUrl} className="size-7 shrink-0" />
                      <span className="block max-w-[16rem] truncate text-foreground" title={c.name}>{c.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="w-px border-r">
                    {c.code
                      ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.code}</code>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="border-r">
                    {c.contactPerson
                      ? <span className="block max-w-[11rem] truncate" title={c.contactPerson}>{c.contactPerson}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="border-r">
                    {c.contactEmail
                      ? <span className="block max-w-[16rem] truncate" title={c.contactEmail}>{c.contactEmail}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="border-r">
                    {c.contactNumber
                      ? <span className="block max-w-[10rem] truncate" title={c.contactNumber}>{c.contactNumber}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="w-px border-r">
                    {/* Which coverage model this client is on. A client is always on
                        exactly one, so this reads as a fact, not a toggle. */}
                    <Badge variant="outline" title={c.contractScope === 'CUSTOMER'
                      ? 'One shared contract covering every product'
                      : 'Each product carries its own warranty/AMC coverage'}>
                      {c.contractScope === 'CUSTOMER' ? 'One contract' : 'Per product'}
                    </Badge>
                  </TableCell>
                  <TableCell className="w-px border-r text-right tabular-nums text-muted-foreground">{c.ticketCount}</TableCell>
                  <TableCell className="w-px border-r">
                    {/* The same bold uppercase pill the task grid uses, so a column
                        of statuses reads at a glance across both screens. */}
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${
                      c.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {c.status}
                    </span>
                  </TableCell>
                  <TableCell className="w-px text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* A consultant is here only to decide an excess-hours request,
                          so the client workspace is the one action they get. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title="Products & consultants"
                        onClick={() => navigate(`/admin/clients/${c.id}`)}
                      >
                        <Boxes className="size-4" />
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="size-8" title={`Edit ${c.name}`} onClick={() => openEdit(c)}>
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          title={`Delete ${c.name}`}
                          onClick={() => { if (confirm(`Delete ${c.name}?`)) deleteMutation.mutate(c.id); }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ContactsSection({ companyId, maxContacts }: { companyId: string; maxContacts: number }) {
  // Read-only for staff: a customer company's people are managed by that
  // company's own admin (self-service), not from this admin console.
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['company-contacts', companyId],
    queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/contacts`)).data,
  });

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="text-sm font-medium">People <span className="font-normal text-muted-foreground">({contacts.length}/{maxContacts})</span></div>
      {contacts.length === 0 && (
        <p className="text-xs text-muted-foreground">No people yet. Once the client has a customer admin, they add the rest.</p>
      )}
      {contacts.map((c) => (
        <div key={c.id} className="flex items-center justify-between rounded-lg border bg-background px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
              {displayName(c)}
              {c.isAdmin && <Badge variant="secondary" className="gap-1"><ShieldCheck className="size-3" /> Admin</Badge>}
            </div>
            <div className="truncate text-xs text-muted-foreground">{c.email}</div>
          </div>
          {!c.isActive && <span className="text-xs text-muted-foreground">Inactive</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Create-a-new-login or link-an-existing-one, the two ways a client gets its
 * admin. The link list is only CustomerAdmins no client holds yet — one already
 * linked elsewhere is never moved, since that would strip the other client.
 */
function CustomerAdminFields({ value, onChange }: { value: AdminInput; onChange: (v: AdminInput) => void }) {
  const { data: available = [], isSuccess } = useQuery<AdminUser[]>({
    queryKey: ['available-admins'],
    queryFn: async () => (await api.get('/api/customer-companies/available-admins')).data,
  });
  const set = (patch: Partial<AdminInput>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-2">
      {/* The hand-rolled RadioGroup re-emits the current value on every click — harmless here. */}
      <RadioGroup value={value.mode} onValueChange={(m) => set({ mode: m as AdminInput['mode'] })} className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="new" /> Create a new admin</label>
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="link" /> Link an existing admin</label>
      </RadioGroup>
      {value.mode === 'new' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Admin username" value={value.username} onChange={(e) => set({ username: e.target.value })} />
            <Input type="email" placeholder="Admin email" value={value.email} onChange={(e) => set({ email: e.target.value })} />
          </div>
          <Input type="text" placeholder="Temporary password (min 6)" value={value.password} onChange={(e) => set({ password: e.target.value })} />
        </>
      ) : isSuccess && available.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No unlinked customer admins. Create one on the Users screen with the CustomerAdmin role, or create a new admin here.
        </p>
      ) : (
        // Radix emits '' when the value isn't among the loaded items — never a real pick, so it is ignored.
        <Select value={value.userId} onValueChange={(v) => { if (v) set({ userId: v }); }}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Pick a customer admin" /></SelectTrigger>
          <SelectContent>
            {available.map((u) => (
              <SelectItem key={u.id} value={u.id}>{displayName(u)} · {u.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/**
 * The Edit dialog's admin slot. A client with an admin shows them, with Unlink
 * to free the seat for another; one without (created by import, or before the
 * admin was required) gets the same create/link fields, saved by their own
 * button rather than the dialog's Save.
 */
function CustomerAdminSection({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [admin, setAdmin] = useState<AdminInput>(emptyAdmin);
  const { data: contacts = [], isSuccess } = useQuery<Contact[]>({
    queryKey: ['company-contacts', companyId],
    queryFn: async () => (await api.get(`/api/customer-companies/${companyId}/contacts`)).data,
  });
  const current = contacts.find((c) => c.isAdmin);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['company-contacts', companyId] });
    qc.invalidateQueries({ queryKey: ['available-admins'] });
    qc.invalidateQueries({ queryKey: ['customer-companies'] });
    qc.invalidateQueries({ queryKey: ['users'] });
  };
  const setMut = useMutation({
    mutationFn: () => api.post(`/api/customer-companies/${companyId}/admin`, admin.mode === 'link'
      ? { userId: admin.userId }
      : { username: admin.username.trim(), email: admin.email.trim(), password: admin.password }),
    onSuccess: () => { refresh(); setAdmin(emptyAdmin); toast.success('Customer admin set'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not set the customer admin'),
  });
  const unlinkMut = useMutation({
    mutationFn: () => api.delete(`/api/customer-companies/${companyId}/admin`),
    onSuccess: () => { refresh(); toast.success('Customer admin unlinked'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not unlink the customer admin'),
  });

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="text-sm font-medium">Customer admin</div>
      {!isSuccess ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : current ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{displayName(current)}</div>
            <div className="truncate text-xs text-muted-foreground">{current.email}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            disabled={unlinkMut.isPending}
            onClick={() => {
              if (confirm(`Unlink ${displayName(current)}? They keep their account but can no longer act for this client until linked again.`)) unlinkMut.mutate();
            }}
          >
            <Unlink className="size-4" /> Unlink
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-amber-700 dark:text-amber-400">This client has no admin yet — nobody can log in for them.</p>
          <CustomerAdminFields value={admin} onChange={setAdmin} />
          <div className="flex justify-end">
            <Button size="sm" disabled={!adminValid(admin) || setMut.isPending} onClick={() => setMut.mutate()}>
              {setMut.isPending ? 'Saving…' : admin.mode === 'link' ? 'Link admin' : 'Create admin'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
