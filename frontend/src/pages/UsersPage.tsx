import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Search, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

interface Role { id: string; name: string; }
interface User {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  userRoles: { role: Role }[];
}

const createUserSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Min 8 characters'),
});
type CreateUserValues = z.infer<typeof createUserSchema>;

const editUserSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  email: z.string().email('Enter a valid email'),
  password: z.string().optional(),
  isActive: z.boolean(),
  roleIds: z.array(z.string()),
}).refine((v) => !v.password || v.password.length >= 8, {
  message: 'Min 8 characters',
  path: ['password'],
});
type EditUserValues = z.infer<typeof editUserSchema>;

type StatusFilter = 'all' | 'active' | 'inactive';
type SortField = 'username' | 'email' | 'status';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 10;

function SortableHead({
  label, field, sortField, sortDir, onSort,
}: {
  label: string; field: SortField; sortField: SortField; sortDir: SortDir; onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase hover:text-foreground"
      >
        {label}
        {active ? (
          sortDir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
        ) : (
          <ArrowUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('username');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const createForm = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { username: '', email: '', password: '' },
  });

  const editForm = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { username: '', email: '', password: '', isActive: true, roleIds: [] },
  });

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/api/roles')).data,
  });

  useEffect(() => {
    if (!editingUser) return;
    editForm.reset({
      username: editingUser.username,
      email: editingUser.email,
      password: '',
      isActive: editingUser.isActive,
      roleIds: editingUser.userRoles.map((ur) => ur.role.id),
    });
  }, [editingUser, editForm]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const createMutation = useMutation({
    mutationFn: (data: CreateUserValues) => api.post('/api/users', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setCreateOpen(false);
      createForm.reset();
      toast.success('User created');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating user'),
  });

  const updateMutation = useMutation({
    mutationFn: async (values: EditUserValues) => {
      if (!editingUser) return;
      await api.put(`/api/users/${editingUser.id}`, {
        username: values.username,
        email: values.email,
        isActive: values.isActive,
        password: values.password || undefined,
      });
      await api.post(`/api/users/${editingUser.id}/roles`, { roleIds: values.roleIds });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
      toast.success('User updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating user'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User deleted'); },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/api/users/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesSearch = !term || u.username.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? u.isActive : !u.isActive);
      return matchesSearch && matchesStatus;
    });
  }, [users, search, statusFilter]);

  const sortedUsers = useMemo(() => {
    const sorted = [...filteredUsers].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'username') cmp = a.username.localeCompare(b.username);
      else if (sortField === 'email') cmp = a.email.localeCompare(b.email);
      else cmp = Number(a.isActive) - Number(b.isActive);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredUsers, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedUsers = sortedUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Users</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New User
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form
              onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
              className="space-y-4"
            >
              <FormField
                control={createForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" placeholder="Min 8 characters" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}
              className="space-y-4"
            >
              <FormField
                control={editForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" placeholder="Leave blank to keep current password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <FormLabel>Active</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="roleIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Roles</FormLabel>
                    <div className="space-y-2 rounded-lg border p-3">
                      {roles.length === 0 && <p className="text-sm text-muted-foreground">No roles available yet.</p>}
                      {roles.map((role) => (
                        <div key={role.id} className="flex items-center gap-2">
                          <Checkbox
                            checked={field.value.includes(role.id)}
                            onCheckedChange={(checked) =>
                              field.onChange(
                                checked
                                  ? [...field.value, role.id]
                                  : field.value.filter((id) => id !== role.id),
                              )
                            }
                          />
                          <span className="text-sm text-foreground">{role.name}</span>
                        </div>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by username or email..."
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {sortedUsers.length} user{sortedUsers.length === 1 ? '' : 's'}
        </span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Username" field="username" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="Email" field="email" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <TableHead>Roles</TableHead>
                <SortableHead label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No users match your filters.
                  </TableCell>
                </TableRow>
              )}
              {pagedUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{u.userRoles.map((r) => r.role.name).join(', ') || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? 'success' : 'destructive'}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingUser(u)}>
                        <Pencil className="size-4" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive })}
                      >
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => { if (confirm('Delete user?')) deleteMutation.mutate(u.id); }}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-4" /> Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
