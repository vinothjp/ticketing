import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, ShieldCheck, User as UserIcon } from 'lucide-react';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface TeamMember {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  role: 'admin' | 'employee';
  isSelf: boolean;
  createdAt: string;
}

export default function CustomerTeamPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'employee' as 'employee' | 'admin' });

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
      setForm({ username: '', email: '', password: '', role: 'employee' });
      toast.success('Team member added');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not add member'),
  });
  const updateMut = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.patch(`/api/my-team/${v.id}`, v.body),
    onSuccess: () => { invalidate(); toast.success('Team member updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not update member'),
  });
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
            Manage your company’s people. Admins see all tickets; employees see only their own.
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
                  <TableCell className="font-medium">
                    {m.username}{m.isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
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
                    {m.isSelf ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm"
                          onClick={() => updateMut.mutate({ id: m.id, body: { role: m.role === 'admin' ? 'employee' : 'admin' } })}>
                          {m.role === 'admin' ? 'Make employee' : 'Make admin'}
                        </Button>
                        {m.isActive ? (
                          <Button variant="outline" size="sm" onClick={() => removeMut.mutate(m.id)}>Deactivate</Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => updateMut.mutate({ id: m.id, body: { isActive: true } })}>Reactivate</Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
            <div>
              <label className="mb-1 block text-sm font-medium">Role</label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as 'employee' | 'admin' })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee — sees only their own tickets</SelectItem>
                  <SelectItem value="admin">Admin — sees all company tickets & manages the team</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
