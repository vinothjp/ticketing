import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, ShieldCheck, User as UserIcon, Pencil } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface TeamMember {
  id: string;
  username: string;
  name: string | null;
  email: string;
  isActive: boolean;
  role: 'admin' | 'employee';
  isSelf: boolean;
  createdAt: string;
}

export default function CustomerTeamPage() {
  const qc = useQueryClient();
  const { logout, patchUser } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  // Profile edit — username, full name and email, for any member including yourself.
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [editForm, setEditForm] = useState({ username: '', name: '', email: '' });
  const openEdit = (m: TeamMember) => {
    setEditing(m);
    setEditForm({ username: m.username, name: m.name ?? '', email: m.email });
  };

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ['my-team'],
    queryFn: async () => (await api.get('/api/my-team')).data,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-team'] });

  const createMut = useMutation({
    mutationFn: () => api.post('/api/my-team', form),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      setForm({ username: '', email: '', password: '' });
      toast.success('Team member added');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not add member'),
  });
  const updateMut = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.patch(`/api/my-team/${v.id}`, v.body),
    onSuccess: (res) => {
      // After a hand-over this login is an employee, but its token still says
      // admin until it signs in again — so it signs out now.
      if (res.data?.handedOver) {
        toast.success('Admin handed over — please sign in again');
        logout();
        return;
      }
      invalidate();
      toast.success('Team member updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not update member'),
  });
  const editMut = useMutation({
    mutationFn: (v: { member: TeamMember; body: typeof editForm }) =>
      api.patch(`/api/my-team/${v.member.id}`, {
        username: v.body.username.trim(),
        name: v.body.name.trim(),
        email: v.body.email.trim(),
      }),
    onSuccess: (res, v) => {
      setEditing(null);
      // Your own username is in your sign-in token, so a new one needs a fresh sign-in.
      if (res.data?.usernameChanged) {
        toast.success('Username changed — please sign in with the new one');
        logout();
        return;
      }
      if (v.member.isSelf) patchUser({ name: v.body.name.trim() || null, email: v.body.email.trim().toLowerCase() });
      invalidate();
      toast.success('Profile updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not update profile'),
  });
  const editDirty = !!editing && (
    editForm.username.trim() !== editing.username
    || editForm.name.trim() !== (editing.name ?? '')
    || editForm.email.trim().toLowerCase() !== editing.email.toLowerCase()
  );
  const editValid = !!editForm.username.trim() && /^\S+@\S+\.\S+$/.test(editForm.email.trim());

  const removeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/my-team/${id}`),
    onSuccess: () => { invalidate(); toast.success('Team member deactivated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not deactivate member'),
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team</h1>
          <p className="text-sm text-muted-foreground">
            Manage your company’s people. You see all company tickets; employees see only their own.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}><UserPlus className="size-4" /> Add member</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && members.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No team members yet.</TableCell></TableRow>}
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">
                      {m.name || m.username}{m.isSelf && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                    </div>
                    {m.name && <div className="text-xs text-muted-foreground">{m.username}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.email}</TableCell>
                  <TableCell>
                    {m.role === 'admin'
                      ? <Badge className="gap-1"><ShieldCheck className="size-3" /> Admin</Badge>
                      : <Badge variant="secondary" className="gap-1"><UserIcon className="size-3" /> Employee</Badge>}
                  </TableCell>
                  <TableCell>
                    {m.isActive
                      ? <span className="text-xs text-emerald-600 dark:text-emerald-400">Active</span>
                      : <span className="text-xs text-muted-foreground">Inactive</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" title="Edit profile" aria-label={`Edit ${m.username}`}
                        onClick={() => openEdit(m)}>
                        <Pencil className="size-4" />
                      </Button>
                    {!m.isSelf && (
                      <>
                        {/* One admin per client: "Make admin" hands your role over
                            (you become an employee); "Make employee" demotes another admin. */}
                        {m.role === 'admin' ? (
                          <Button variant="outline" size="sm" disabled={updateMut.isPending}
                            onClick={() => updateMut.mutate({ id: m.id, body: { role: 'employee' } })}>
                            Make employee
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" disabled={updateMut.isPending || !m.isActive}
                            title={m.isActive ? undefined : 'Reactivate them first'}
                            onClick={() => {
                              if (confirm(`Make ${m.username} the admin? Your company has one admin, so you will become an employee and be signed out.`)) {
                                updateMut.mutate({ id: m.id, body: { role: 'admin' } });
                              }
                            }}>
                            Make admin
                          </Button>
                        )}
                        {m.isActive ? (
                          <Button variant="outline" size="sm" onClick={() => removeMut.mutate(m.id)}>Deactivate</Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => updateMut.mutate({ id: m.id, body: { isActive: true } })}>Reactivate</Button>
                        )}
                      </>
                    )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.isSelf ? 'Edit your profile' : `Edit ${editing?.username ?? ''}`}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Username</label>
              <Input value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Full name</label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              {editing?.isSelf
                ? 'Changing your username signs you out — sign back in with the new one.'
                : 'They sign in with the new username or email from their next login.'}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={!editDirty || !editValid || editMut.isPending}
              onClick={() => editing && editMut.mutate({ member: editing, body: editForm })}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add team member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Username</label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="jane" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Temporary password</label>
              <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 6 characters" />
            </div>
            {/* No role choice: a client has one admin, set by the provider, so
                everyone added here is an employee. */}
            <p className="text-xs text-muted-foreground">They join as an employee and see only their own tickets.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.username.trim() || !form.email.trim() || form.password.length < 6 || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              Add member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
