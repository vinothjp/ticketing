import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Building2, Boxes, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import CompanyLogo from '@/components/CompanyLogo';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

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
  contactCount: number;
  ticketCount: number;
}
interface Contact { id: string; username: string; email: string; isActive: boolean; }

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const empty = {
  name: '', code: '', contactEmail: '', contactPerson: '', contactNumber: '', maxContacts: 5,
  adminUsername: '', adminEmail: '', adminPassword: '',
};

export default function CustomerCompaniesPage() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);
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
      // Optional bootstrap: seed the first CustomerAdmin login on creation.
      if (c.adminUsername && c.adminEmail && c.adminPassword) {
        body.adminUsername = c.adminUsername;
        body.adminEmail = c.adminEmail;
        body.adminPassword = c.adminPassword;
      }
      const created = await api.post('/api/customer-companies', body);
      // The logo needs the new id, so it goes up right after the company lands.
      if (pendingLogo) await uploadLogo(created.data.id, pendingLogo);
      return created;
    },
    onSuccess: () => { invalidate(); closeForm(); toast.success(editing ? 'Company updated' : 'Company created'); },
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
  const openCreate = () => { setEditing(null); setForm(empty); clearPending(); setFormOpen(true); };
  const openEdit = (c: Company) => {
    setEditing(c);
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
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground">External clients whose contacts can log in and raise tickets.</p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4" /> New Client</Button>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-8" />
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
                <ContactsSection companyId={editing.id} maxContacts={form.maxContacts} />
                <Button variant="outline" className="w-full" onClick={() => { const id = editing.id; closeForm(); navigate(`/admin/clients/${id}`); }}>
                  <Boxes className="size-4" /> Products &amp; consultants
                </Button>
                <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Products, warranty, AMC and default consultants are managed there.
                </p>
              </>
            )}

            {!editing && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="text-sm font-medium">First admin login <span className="font-normal text-muted-foreground">(optional)</span></div>
                <p className="text-xs text-muted-foreground">
                  Seed the company’s first admin. After this hand-off, they manage their own team — you won’t add users here.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Admin username" value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} />
                  <Input type="email" placeholder="Admin email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
                </div>
                <Input type="text" placeholder="Temporary password (min 6)" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name.trim() || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Building2 className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{companies.length === 0 ? 'No clients yet.' : 'No clients match your search.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((c) => (
            // A div, not a button — the delete control below cannot nest in one.
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => openEdit(c)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(c); } }}
              className="relative flex cursor-pointer flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 size-7 text-muted-foreground hover:text-destructive"
                title={`Delete ${c.name}`}
                onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${c.name}?`)) deleteMutation.mutate(c.id); }}
              >
                <Trash2 className="size-4" />
              </Button>
              <CompanyLogo logoUrl={c.logoUrl} />
              <div className="min-w-0">
                <div className="truncate font-semibold text-foreground">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.code || '—'}</div>
              </div>
              <Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>{c.status}</Badge>
              <div className="text-xs text-muted-foreground">
                {c.contactCount}/{c.maxContacts} people · {c.ticketCount} tickets
              </div>
            </div>
          ))}
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
        <p className="text-xs text-muted-foreground">No people yet. Seed a first admin when creating the company; they add the rest.</p>
      )}
      {contacts.map((c) => (
        <div key={c.id} className="flex items-center justify-between rounded-lg border bg-background px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{c.username}</div>
            <div className="truncate text-xs text-muted-foreground">{c.email}</div>
          </div>
          {!c.isActive && <span className="text-xs text-muted-foreground">Inactive</span>}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        People are managed by this company’s own admin. You only seed the first admin at creation.
      </p>
    </div>
  );
}
