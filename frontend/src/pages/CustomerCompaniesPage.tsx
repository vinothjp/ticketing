import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Users2, Trash2, Building2, Boxes } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import CompanyProductsDialog from './customer-companies/CompanyProductsDialog';

interface Company {
  id: string;
  name: string;
  code?: string | null;
  contactEmail?: string | null;
  status: string;
  maxContacts: number;
  contactCount: number;
  ticketCount: number;
  agreedSupportHours?: number | null;
  supportPeriodStart?: string | null;
  supportPeriodEnd?: string | null;
  supportAlertThresholdPct?: number;
}
interface Contact { id: string; username: string; email: string; isActive: boolean; }

const empty = {
  name: '', code: '', contactEmail: '', maxContacts: 5,
  agreedSupportHours: '', supportPeriodStart: '', supportPeriodEnd: '', supportAlertThresholdPct: 70,
  adminUsername: '', adminEmail: '', adminPassword: '',
};

export default function CustomerCompaniesPage() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);
  const [contactsFor, setContactsFor] = useState<Company | null>(null);
  const [productsFor, setProductsFor] = useState<Company | null>(null);

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['customer-companies'] });

  const saveMutation = useMutation({
    mutationFn: (c: typeof form) => {
      const body: Record<string, unknown> = {
        name: c.name, code: c.code || undefined, contactEmail: c.contactEmail || undefined,
        maxContacts: Number(c.maxContacts),
        // Support-hours pool — send null to clear, so a company can drop the pool.
        agreedSupportHours: c.agreedSupportHours === '' ? null : Number(c.agreedSupportHours),
        supportPeriodStart: c.supportPeriodStart || null,
        supportPeriodEnd: c.supportPeriodEnd || null,
        supportAlertThresholdPct: Number(c.supportAlertThresholdPct) || 70,
      };
      if (editing) return api.patch(`/api/customer-companies/${editing.id}`, body);
      // Optional bootstrap: seed the first CustomerAdmin login on creation.
      if (c.adminUsername && c.adminEmail && c.adminPassword) {
        body.adminUsername = c.adminUsername;
        body.adminEmail = c.adminEmail;
        body.adminPassword = c.adminPassword;
      }
      return api.post('/api/customer-companies', body);
    },
    onSuccess: () => { invalidate(); setFormOpen(false); setEditing(null); toast.success(editing ? 'Company updated' : 'Company created'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving company'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/customer-companies/${id}`),
    onSuccess: () => { invalidate(); toast.success('Company deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting company'),
  });

  const openCreate = () => { setEditing(null); setForm(empty); setFormOpen(true); };
  const openEdit = async (c: Company) => {
    setEditing(c);
    setForm({
      ...empty, name: c.name, code: c.code ?? '', contactEmail: c.contactEmail ?? '', maxContacts: c.maxContacts,
      agreedSupportHours: c.agreedSupportHours == null ? '' : String(c.agreedSupportHours),
      supportPeriodStart: c.supportPeriodStart ? c.supportPeriodStart.slice(0, 10) : '',
      supportPeriodEnd: c.supportPeriodEnd ? c.supportPeriodEnd.slice(0, 10) : '',
      supportAlertThresholdPct: c.supportAlertThresholdPct ?? 70,
    });
    setFormOpen(true);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Customer Companies</h1>
          <p className="text-sm text-muted-foreground">External customers whose contacts can log in and raise tickets.</p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4" /> New Company</Button>
      </div>

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col">
          <DialogHeader><DialogTitle>{editing ? 'Edit Company' : 'New Customer Company'}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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

            {editing && (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Products, warranty and AMC are managed from the <span className="font-medium text-foreground">Products</span> button on the company row.
              </p>
            )}

            {/* Agreed support-hours pool for the period. Leave hours blank to disable. */}
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <div className="text-sm font-medium">Support hours <span className="font-normal text-muted-foreground">(optional)</span></div>
              <p className="text-xs text-muted-foreground">
                Agreed working hours for the period. When usage crosses the alert threshold, the customer is emailed and notified. Leave hours blank to disable.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Agreed hours</label>
                  <Input type="number" min={0} step="0.5" value={form.agreedSupportHours}
                    onChange={(e) => setForm({ ...form, agreedSupportHours: e.target.value })} placeholder="e.g. 150" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Alert at (%)</label>
                  <Input type="number" min={1} max={100} value={form.supportAlertThresholdPct}
                    onChange={(e) => setForm({ ...form, supportAlertThresholdPct: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Period start</label>
                  <Input type="date" value={form.supportPeriodStart}
                    onChange={(e) => setForm({ ...form, supportPeriodStart: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Period end</label>
                  <Input type="date" value={form.supportPeriodEnd}
                    onChange={(e) => setForm({ ...form, supportPeriodEnd: e.target.value })} />
                </div>
              </div>
            </div>

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

      {contactsFor && <ContactsDialog company={contactsFor} onClose={() => setContactsFor(null)} onChanged={invalidate} />}
      {productsFor && <CompanyProductsDialog companyId={productsFor.id} companyName={productsFor.name} onClose={() => setProductsFor(null)} />}

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : companies.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Building2 className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No customer companies yet.</p>
        </div>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Contacts</TableHead>
                <TableHead>Tickets</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.code || '—'}</TableCell>
                  <TableCell>{c.contactCount} / {c.maxContacts}</TableCell>
                  <TableCell>{c.ticketCount}</TableCell>
                  <TableCell><Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>{c.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setProductsFor(c)}><Boxes className="size-4" /> Products</Button>
                      <Button size="sm" variant="outline" onClick={() => setContactsFor(c)}><Users2 className="size-4" /> People</Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(c)}><Pencil className="size-4" /> Edit</Button>
                      <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Delete ${c.name}?`)) deleteMutation.mutate(c.id); }}>
                        <Trash2 className="size-4" />
                      </Button>
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

function ContactsDialog({ company, onClose }: { company: Company; onClose: () => void; onChanged: () => void }) {
  // Read-only for staff: a customer company's people are managed by that
  // company's own admin (self-service), not from this admin console.
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['company-contacts', company.id],
    queryFn: async () => (await api.get(`/api/customer-companies/${company.id}/contacts`)).data,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{company.name} — people ({contacts.length}/{company.maxContacts})</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {contacts.length === 0 && <p className="text-sm text-muted-foreground">No people yet. Seed a first admin when creating the company; they add the rest.</p>}
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{c.username}</div>
                <div className="truncate text-xs text-muted-foreground">{c.email}</div>
              </div>
              {!c.isActive && <span className="text-xs text-muted-foreground">Inactive</span>}
            </div>
          ))}
        </div>

        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          People are managed by this company’s own admin. You only seed the first admin at creation.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
