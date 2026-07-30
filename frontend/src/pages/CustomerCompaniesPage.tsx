import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Users2, Trash2, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Company {
  id: string;
  name: string;
  code?: string | null;
  contactEmail?: string | null;
  status: string;
  maxContacts: number;
  contactCount: number;
  ticketCount: number;
}
interface Contact { id: string; username: string; email: string; isActive: boolean; }

const empty = { name: '', code: '', contactEmail: '', maxContacts: 5 };

export default function CustomerCompaniesPage() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState<{ name: string; code: string; contactEmail: string; maxContacts: number }>(empty);
  const [contactsFor, setContactsFor] = useState<Company | null>(null);

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['customer-companies'] });

  const saveMutation = useMutation({
    mutationFn: (c: typeof form) => {
      const body = { name: c.name, code: c.code || undefined, contactEmail: c.contactEmail || undefined, maxContacts: Number(c.maxContacts) };
      return editing ? api.patch(`/api/customer-companies/${editing.id}`, body) : api.post('/api/customer-companies', body);
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
  const openEdit = (c: Company) => {
    setEditing(c);
    setForm({ name: c.name, code: c.code ?? '', contactEmail: c.contactEmail ?? '', maxContacts: c.maxContacts });
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
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit Company' : 'New Customer Company'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
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
          </div>
          <DialogFooter>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.name.trim() || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {contactsFor && <ContactsDialog company={contactsFor} onClose={() => setContactsFor(null)} onChanged={invalidate} />}

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
                      <Button size="sm" variant="outline" onClick={() => setContactsFor(c)}><Users2 className="size-4" /> Contacts</Button>
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

function ContactsDialog({ company, onClose, onChanged }: { company: Company; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [nu, setNu] = useState({ username: '', email: '', password: '' });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['company-contacts', company.id],
    queryFn: async () => (await api.get(`/api/customer-companies/${company.id}/contacts`)).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['company-contacts', company.id] });
    onChanged();
  };

  const addMutation = useMutation({
    mutationFn: () => api.post(`/api/customer-companies/${company.id}/contacts`, nu),
    onSuccess: () => { refresh(); setNu({ username: '', email: '', password: '' }); toast.success('Contact added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding contact'),
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/customer-companies/${company.id}/contacts/${userId}`),
    onSuccess: () => { refresh(); toast.success('Contact removed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error removing contact'),
  });

  const atLimit = contacts.length >= company.maxContacts;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{company.name} — contacts ({contacts.length}/{company.maxContacts})</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {contacts.length === 0 && <p className="text-sm text-muted-foreground">No contacts yet.</p>}
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{c.username}</div>
                <div className="truncate text-xs text-muted-foreground">{c.email}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove ${c.username}?`)) removeMutation.mutate(c.id); }}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-2 space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">Add contact</div>
          {atLimit ? (
            <p className="text-xs text-destructive">This company has reached its {company.maxContacts}-contact limit.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Username" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
                <Input type="email" placeholder="Email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
              </div>
              <Input type="password" placeholder="Temp password (min 8)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
              <Button
                size="sm"
                onClick={() => addMutation.mutate()}
                disabled={!nu.username.trim() || !nu.email.trim() || nu.password.length < 8 || addMutation.isPending}
              >
                <Plus className="size-4" /> Add contact
              </Button>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
