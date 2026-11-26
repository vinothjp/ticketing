import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Pencil, Trash2, Building2, Boxes, Search, Upload, ShieldCheck, Unlink,
  Hash, AtSign, Mail, Phone, FileText, MessageSquare, CircleDot, ChevronLeft, ChevronRight,
  Layers, UserRound, Users, Ticket, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { CLIENT_TYPE_OPTIONS, clientTypeLabel, isServicesOnly, type ClientType } from '@/lib/clientType';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import CompanyLogo from '@/components/CompanyLogo';
import MultiCheckSelect from '@/components/MultiCheckSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '../context/AuthContext';
import ImportExportBar from '@/components/ImportExportBar';
import type { ReactNode } from 'react';
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
  /** Auto-generated client id (CC-000001); set by the server on create, never edited. */
  companyCode?: string | null;
  /** Departments offered on this client's New Ticket form; empty = all. */
  departments?: string[];
  contactEmail?: string | null;
  contactPerson?: string | null;
  contactNumber?: string | null;
  logoUrl?: string | null;
  status: string;
  maxContacts: number;
  ticketCount: number;
  contractScope?: 'PRODUCT' | 'CUSTOMER';
  clientType?: ClientType;
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
  departments: [] as string[],
  // Required on New Client and deliberately not preselected: what the client
  // bought decides which screens they get, so the admin has to say.
  clientType: '' as ClientType | '',
};

/** The list's Type pill: what the client bought and, for AMC, which coverage model. */
function typePill(c: Company) {
  if (isServicesOnly(c.clientType)) {
    const label = clientTypeLabel(c.clientType);
    return { label, title: `${label} — services only, no AMC`, cls: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300' };
  }
  return c.contractScope === 'CUSTOMER'
    ? { label: 'AMC · One contract', title: 'AMC — one shared contract covering every product', cls: 'border-primary/30 bg-primary/10 text-primary' }
    : { label: 'AMC · Per product', title: 'AMC — each product carries its own warranty/AMC coverage', cls: 'border-primary/30 bg-primary/10 text-primary' };
}

/**
 * A titled card on the New / Edit Client page: icon, heading and a one-line
 * description in a tinted header, the fields below it.
 */
function FormSection({ icon: Icon, title, description, children }: {
  icon: LucideIcon; title: ReactNode; description?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <header className="flex items-center gap-3 border-b bg-muted/30 px-5 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

/**
 * A group heading inside a FormSection: small icon and label, an optional
 * one-line description. Spacing alone separates the groups — no divider lines
 * (client request).
 */
function SubHeading({ icon: Icon, required, description, children }: {
  icon: LucideIcon; required?: boolean; description?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="pt-2 first:pt-0">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" />
        {children}{required && <span className="-ml-1.5 text-destructive">*</span>}
      </div>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

/** A labelled form field: label (with a required star), control, optional hint. */
function Field({ label, required, hint, children, className = '' }: {
  label: ReactNode; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-sm font-medium text-foreground">
        {label}{required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * `createPage` renders the New Client full page (/admin/customer-companies/new),
 * `editPage` the Edit Client page (/admin/customer-companies/:companyId/edit);
 * neither renders the list. Both share one form, so they can never drift apart.
 */
export default function CustomerCompaniesPage({ createPage = false, editPage = false }: { createPage?: boolean; editPage?: boolean }) {
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const qc = useQueryClient();
  const { companyId: editId } = useParams<{ companyId?: string }>();
  const formPage = createPage || editPage;
  // The Department option list, for the form's Departments picker (active values only).
  const { data: departmentOptions = [] } = useQuery<{ value: string; label: string }[]>({
    queryKey: ['picklist-options', 'department'],
    queryFn: async () => (await api.get('/api/picklist-options', { params: { listKey: 'department' } })).data,
    enabled: formPage,
  });
  const [form, setForm] = useState<typeof empty>(empty);
  const [admin, setAdmin] = useState<AdminInput>(emptyAdmin);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ClientType>('all');
  // A client-type change on Edit waits here for its confirmation: going to
  // Implementation clears every AMC term, so it is never applied on Save alone.
  const [confirmType, setConfirmType] = useState<ClientType | null>(null);
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
    return companies.filter((c) =>
      (typeFilter === 'all' || (c.clientType ?? 'AMC') === typeFilter)
      && (!term || c.name.toLowerCase().includes(term) || (c.code ?? '').toLowerCase().includes(term) || (c.companyCode ?? '').toLowerCase().includes(term)));
  }, [companies, q, typeFilter]);

  // Client-side paging (the whole list is one query). The page in play is clamped,
  // since narrowing the filters can leave it past the end, and every filter or
  // page-size change returns to the first page.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageNow = Math.min(page, pageCount);
  const pageStart = (pageNow - 1) * pageSize;
  const paged = filtered.slice(pageStart, pageStart + pageSize);
  useEffect(() => { setPage(1); }, [q, typeFilter, pageSize]);

  // The edited client, read from the list query so the logo refreshes after upload.
  const editing = editPage ? companies.find((c) => c.id === editId) ?? null : null;
  const current = editing;

  // Hydrate the Edit form once per client — never again on a refetch, which
  // would throw away whatever the admin has typed.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!editing || hydratedFor.current === editing.id) return;
    hydratedFor.current = editing.id;
    setForm({
      ...empty, name: editing.name, code: editing.code ?? '', contactEmail: editing.contactEmail ?? '',
      contactPerson: editing.contactPerson ?? '', contactNumber: editing.contactNumber ?? '', maxContacts: editing.maxContacts,
      departments: editing.departments ?? [],
      clientType: editing.clientType ?? 'AMC',
    });
  }, [editing]);

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
        departments: c.departments,
      };
      if (editing) {
        // A confirmed type change goes first, on its own route — it is the half
        // that clears terms, so the rest of the save never runs without it.
        if (c.clientType && c.clientType !== (editing.clientType ?? 'AMC')) {
          await api.put(`/api/customer-companies/${editing.id}/client-type`, { type: c.clientType });
          for (const key of ['client', 'client-contract', 'client-products']) qc.invalidateQueries({ queryKey: [key, editing.id] });
        }
        return api.patch(`/api/customer-companies/${editing.id}`, body);
      }
      body.clientType = c.clientType;
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

  const closeForm = () => {
    clearPending();
    navigate('/admin/customer-companies');
  };
  const openCreate = () => navigate('/admin/customer-companies/new');
  const openEdit = (c: Company) => navigate(`/admin/customer-companies/${c.id}/edit`);

  const hasLogo = editing ? !!current?.logoUrl : !!pendingPreview;

  // Save on Edit asks first when the client type is being changed.
  const typeChanged = !!editing && !!form.clientType && form.clientType !== (editing.clientType ?? 'AMC');
  const onSave = () => {
    if (typeChanged) { setConfirmType(form.clientType as ClientType); return; }
    saveMutation.mutate(form);
  };

  const saveDisabled = !form.name.trim() || !form.clientType || (!editing && !adminValid(admin)) || saveMutation.isPending;

  // Changing what a client bought, confirmed before anything is written.
  const confirmDialog = (
    <Dialog open={!!confirmType} onOpenChange={(o) => { if (!o) setConfirmType(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Switch {editing?.name ?? 'this client'} to {clientTypeLabel(confirmType)}?</DialogTitle>
        </DialogHeader>
        {isServicesOnly(confirmType) && isServicesOnly(editing?.clientType) ? (
          <p className="text-sm text-muted-foreground">
            Neither type carries an AMC, so nothing is cleared — products, consultants, contract services and tickets are kept.
          </p>
        ) : isServicesOnly(confirmType) ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{clientTypeLabel(confirmType)} clients have no AMC. Once you switch:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>The AMC terms, support-hours pool, visits allowance, contract services and purchase order are <strong className="text-foreground">cleared</strong> — on this client and on each of its products.</li>
              <li>Tickets are no longer counted against support hours, and no expiry or hours-low reminders go out.</li>
              <li>Products, consultants and existing tickets are <strong className="text-foreground">kept</strong>.</li>
            </ul>
            <p>Switching back to AMC later starts with blank terms to fill in.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The client gets a support contract. It starts as <strong className="text-foreground">Per product</strong> with
            blank terms — choose the contract type on the client screen, then enter and save the terms. Products,
            consultants and tickets are kept.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmType(null)}>Cancel</Button>
          <Button disabled={saveMutation.isPending} onClick={() => { setConfirmType(null); saveMutation.mutate(form); }}>Switch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // New Client and Edit Client are full pages sharing this one form.
  if (formPage) {
    if (editPage && !editing) {
      return (
        <div className="mx-auto w-full max-w-6xl">
          <Button variant="ghost" size="sm" onClick={closeForm} className="mb-2 -ml-2">
            <ArrowLeft className="size-4" /> All clients
          </Button>
          <p className="text-sm text-muted-foreground">{isLoading ? 'Loading…' : 'Client not found.'}</p>
        </div>
      );
    }
    const actions = (
      <div className="flex gap-2">
        <Button variant="outline" onClick={closeForm}>Cancel</Button>
        <Button onClick={onSave} disabled={saveDisabled}>
          {saveMutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create client'}
        </Button>
      </div>
    );
    return (
      <div className="mx-auto w-full max-w-6xl">
        {/* Top row: back link on the left; on Edit, Cancel / Save on the right
            (New puts them in the heading row, where Edit has its products card). */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={closeForm} className="-ml-2 text-muted-foreground">
            <ArrowLeft className="size-4" /> All clients
          </Button>
          {editing && actions}
        </div>

        {/* Heading: the client as it will read in the list; on Edit, the way out
            to its products and consultants sits on the right. */}
        {/* One 2/3 + 1/3 grid for the heading and the panels, so both panels start
            on one line. Over the right column sits the Products & consultants card
            on Edit, and Cancel / Create on New (which has no card to show). */}
        <div className="grid items-start gap-5 lg:grid-cols-3">
          <div className="flex min-w-0 items-center gap-4 self-center lg:col-span-2">
            {editing && <CompanyLogo logoUrl={current?.logoUrl} className="size-14 shrink-0 rounded-xl border" />}
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight" title={editing?.name}>
                {editing ? form.name.trim() || editing.name : 'New Client'}
              </h1>
              {editing ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {editing.companyCode && <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{editing.companyCode}</code>}
                  <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${typePill(editing).cls}`}>
                    {typePill(editing).label}
                  </span>
                  <span>Edit client details</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Fields marked <span className="text-destructive">*</span> are required.</p>
              )}
            </div>
          </div>
          {editing && (
            <button type="button"
              onClick={() => navigate(`/admin/clients/${editing.id}`)}
              className="group flex w-full items-center gap-3 self-center rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/40 hover:bg-primary/5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Boxes className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">Products &amp; consultants</span>
                <span className="block text-xs text-muted-foreground">Products, warranty, AMC and default consultants.</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
          {!editing && <div className="flex justify-end self-center">{actions}</div>}

          {/* The client's own details in one card, split into Company · Client
              type · Contact by dividers rather than three separate cards. */}
          <div className="lg:col-span-2">
            <FormSection icon={Building2} title="Client details" description="Who the client is, what they bought and how to reach them.">
              <div className="flex items-center gap-4 rounded-lg border border-dashed p-3">
                <CompanyLogo logoUrl={pendingPreview ?? current?.logoUrl} className="size-14 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Logo <span className="font-normal text-muted-foreground">(optional)</span></div>
                  <p className="text-xs text-muted-foreground">PNG, JPG or SVG, up to 2 MB.</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-muted">
                    <Upload className="size-3.5" /> {hasLogo ? 'Change' : 'Upload'}
                    <input ref={fileRef} type="file" accept="image/*" className="hidden"
                      onChange={(e) => onPickLogo(e.target.files?.[0])} />
                  </label>
                  {hasLogo && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={removeLogo}>Remove</Button>
                  )}
                </div>
              </div>

              <Field label="Company name" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Globex Ltd" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                {/* Generated by the server when the client is created, so it is shown,
                    never typed — a new client has no number until it is saved. */}
                <Field label="Company code">
                  <Input value={current?.companyCode ?? ''} readOnly disabled
                    placeholder={editing ? '—' : 'Generated on save'} title="Generated automatically" />
                </Field>
                <Field label="Short name">
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="GLX" />
                </Field>
                <Field label="Max contacts">
                  <Input type="number" min={1} max={50} value={form.maxContacts} onChange={(e) => setForm({ ...form, maxContacts: Number(e.target.value) })} />
                </Field>
              </div>

              <SubHeading icon={Layers} required>Client type</SubHeading>
              <ClientTypeChoice value={form.clientType} onChange={(t) => setForm({ ...form, clientType: t })} />

              <SubHeading icon={UserRound}>Contact</SubHeading>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contact person">
                  <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="e.g. Priya Nair" />
                </Field>
                <Field label="Contact number">
                  <Input value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} placeholder="e.g. +91 98765 43210" />
                </Field>
              </div>
              <Field label="Contact email">
                <Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="ops@globex.example" />
              </Field>
            </FormSection>
          </div>

          <div className="space-y-5">
            {/* Login, departments and people in one card, like the left side. */}
            <FormSection icon={ShieldCheck} title="Client access" description="Who logs in for the client and what they can raise.">
              {/* The client's one customer admin: required on create; on edit, shown
                  with Unlink, or set here once if the client has none. */}
              <SubHeading icon={ShieldCheck} required={!editing}
                description="The client’s login. They manage their own team after this.">
                Customer admin
              </SubHeading>
              {editing
                ? <CustomerAdminSection companyId={editing.id} />
                : <CustomerAdminFields value={admin} onChange={setAdmin} />}

              {/* Which departments this client's New Ticket form offers. Values come
                  from the Department option list; none ticked = every department. */}
              <SubHeading icon={Ticket}
                description="Shown in the Department dropdown on this client's new tickets. Leave empty for all.">
                Departments involved
              </SubHeading>
              <MultiCheckSelect listBelow
                options={departmentOptions}
                value={form.departments}
                onChange={(departments) => setForm({ ...form, departments })}
                emptyLabel="All departments" />

              {editing && (
                <>
                  <SubHeading icon={Users} description="Managed by the client’s admin in My Team.">People</SubHeading>
                  <ContactsSection companyId={editing.id} maxContacts={form.maxContacts} />
                </>
              )}
            </FormSection>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t pt-4">{actions}</div>
        {confirmDialog}
      </div>
    );
  }

  return (
    <div>
      {/* New Client sits on the heading's right, so it never wraps under the
          search/filter/import row on a narrower window. */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground">External clients whose contacts can log in and raise tickets.</p>
        </div>
        {isAdmin && <Button onClick={openCreate}><Plus className="size-4" /> New Client</Button>}
      </div>

      {/* Search and every action on one row, the shape both masters use. The
          import/export trio is Admin-only: the sheet carries contact detail, and
          posting one back adds and edits clients. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-8" />
        </div>
        <Select value={typeFilter} onValueChange={(v) => { if (v) setTypeFilter(v as typeof typeFilter); }}>
          <SelectTrigger className="w-40" aria-label="Filter by client type"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {CLIENT_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
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
          </>
        )}
      </div>

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
                <TableHead className="border-r"><HeadLabel icon={Hash}>Short name</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={AtSign}>Contact</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Mail}>Email</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Phone}>Phone</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={FileText}>Type</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={MessageSquare} className="justify-end">Tickets</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={CircleDot}>Status</HeadLabel></TableHead>
                <TableHead className="text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((c) => (
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
                    {/* What the client bought and, for AMC, which coverage model it is on. */}
                    <span title={typePill(c).title}
                      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${typePill(c).cls}`}>
                      {typePill(c).label}
                    </span>
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
                      {/* A consultant only reads a client, so the client workspace
                          is the one action they get. */}
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

      {!isLoading && filtered.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Showing <span className="tabular-nums text-foreground">{pageStart + 1}–{pageStart + paged.length}</span> of{' '}
            <span className="tabular-nums text-foreground">{filtered.length}</span>
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => v && setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-20"><SelectValue placeholder="5" /></SelectTrigger>
                <SelectContent>
                  {[5, 10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="icon" className="size-8" title="Previous page"
                disabled={pageNow <= 1} onClick={() => setPage(pageNow - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-1 tabular-nums text-muted-foreground">Page {pageNow} of {pageCount}</span>
              <Button
                variant="outline" size="icon" className="size-8" title="Next page"
                disabled={pageNow >= pageCount} onClick={() => setPage(pageNow + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
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
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Seats used</span>
        <span className="tabular-nums font-medium text-foreground">{contacts.length} / {maxContacts}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (contacts.length / Math.max(1, maxContacts)) * 100)}%` }} />
      </div>
      {contacts.length === 0 ? (
        <p className="pt-1 text-xs text-muted-foreground">No people yet. Once the client has a customer admin, they add the rest.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
                {displayName(c).slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <span className="truncate" title={displayName(c)}>{displayName(c)}</span>
                  {c.isAdmin && <Badge variant="secondary" className="shrink-0 gap-1"><ShieldCheck className="size-3" /> Admin</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground" title={c.email}>{c.email}</div>
              </div>
              {!c.isActive && <span className="shrink-0 text-xs text-muted-foreground">Inactive</span>}
            </li>
          ))}
        </ul>
      )}
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
    <div className="space-y-3">
      {/* A two-way segmented switch. The hand-rolled RadioGroup re-emits the
          current value on every click — harmless here. */}
      <RadioGroup value={value.mode} onValueChange={(m) => set({ mode: m as AdminInput['mode'] })}
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {([['new', 'Create new'], ['link', 'Link existing']] as const).map(([m, label]) => (
          <label key={m}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
              value.mode === m ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}>
            <span className="sr-only"><RadioGroupItem value={m} /></span>{label}
          </label>
        ))}
      </RadioGroup>
      {value.mode === 'new' ? (
        <div className="space-y-3">
          <Field label="Username">
            <Input placeholder="e.g. globex.admin" value={value.username} onChange={(e) => set({ username: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" placeholder="admin@globex.example" value={value.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Temporary password" hint="At least 6 characters.">
            <Input type="text" value={value.password} onChange={(e) => set({ password: e.target.value })} />
          </Field>
        </div>
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
    <div className="space-y-3">
      {!isSuccess ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : current ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
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

/**
 * What the client bought, as plain radio options. Set here and only here — the
 * client screen carries just the AMC contract type. Changing it on Edit is
 * confirmed before it is written (see `onSave`).
 */
function ClientTypeChoice({ value, onChange }: { value: ClientType | ''; onChange: (t: ClientType) => void }) {
  return (
    // Plain radios, no hints (client request) — laid out as even tiles so the
    // picked one stands out. Hand-rolled RadioGroup fires on every click — ignore a re-pick.
    <RadioGroup value={value} onValueChange={(v) => { if (v && v !== value) onChange(v as ClientType); }}
      className="grid grid-cols-2 gap-2">
      {CLIENT_TYPE_OPTIONS.map((o) => (
        <label key={o.value}
          className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
            value === o.value ? 'border-primary bg-primary/5 font-medium text-foreground' : 'hover:bg-muted/50'}`}>
          <RadioGroupItem value={o.value} /> {o.label}
        </label>
      ))}
    </RadioGroup>
  );
}
