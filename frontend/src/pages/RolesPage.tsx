import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Lock } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import PermissionMatrix from '@/components/PermissionMatrix';

interface Role { id: string; name: string; description?: string; _count: { userRoles: number }; }

const roleSchema = z.object({
  name: z.string().min(1, 'Role name is required'),
  description: z.string().optional(),
});
type RoleValues = z.infer<typeof roleSchema>;

export default function RolesPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  const createForm = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: '', description: '' },
  });

  const editForm = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: '', description: '' },
  });

  const { data: roles = [], isLoading } = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/api/roles')).data,
  });

  useEffect(() => {
    if (!editingRole) return;
    editForm.reset({ name: editingRole.name, description: editingRole.description ?? '' });
  }, [editingRole, editForm]);

  const createMutation = useMutation({
    mutationFn: (data: RoleValues) => api.post('/api/roles', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setCreateOpen(false);
      createForm.reset();
      toast.success('Role created');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating role'),
  });

  const updateMutation = useMutation({
    mutationFn: (values: RoleValues) => api.put(`/api/roles/${editingRole!.id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setEditingRole(null);
      toast.success('Role updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating role'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/roles/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast.success('Role deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting role'),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Roles</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New Role
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Role</DialogTitle>
          </DialogHeader>
          <Form {...createForm}>
            <form
              onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
              className="space-y-4"
            >
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role Name</FormLabel>
                    <FormControl><Input placeholder="e.g. Manager" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Input placeholder="Optional" {...field} /></FormControl>
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

      <Dialog open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}
              className="space-y-4"
            >
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role Name</FormLabel>
                    <FormControl><Input disabled={editingRole?.name === 'Admin'} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Input placeholder="Optional" {...field} /></FormControl>
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

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Users</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((r) => {
                const isAdmin = r.name === 'Admin';
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.description || '—'}</TableCell>
                    <TableCell>{r._count.userRoles}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingRole(r)}>
                          <Pencil className="size-4" /> Edit
                        </Button>
                        {isAdmin ? (
                          <Button size="sm" variant="outline" disabled title="The Admin role cannot be deleted">
                            <Lock className="size-4" /> Protected
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => { if (confirm('Delete role?')) deleteMutation.mutate(r.id); }}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
          <CardDescription>Toggle permissions for each role and form</CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionMatrix />
        </CardContent>
      </Card>
    </div>
  );
}
