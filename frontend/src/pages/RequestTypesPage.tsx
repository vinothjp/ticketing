import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Plus, Pencil, LayoutTemplate } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

interface RequestType {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  template: { id: string } | null;
}

const requestTypeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
});
type RequestTypeValues = z.infer<typeof requestTypeSchema>;

export default function RequestTypesPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RequestType | null>(null);

  const createForm = useForm<RequestTypeValues>({
    resolver: zodResolver(requestTypeSchema),
    defaultValues: { name: '', description: '' },
  });
  const editForm = useForm<RequestTypeValues>({
    resolver: zodResolver(requestTypeSchema),
    defaultValues: { name: '', description: '' },
  });

  const { data: requestTypes = [], isLoading } = useQuery<RequestType[]>({
    queryKey: ['request-types'],
    queryFn: async () => (await api.get('/api/request-types')).data,
  });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({ name: editing.name, description: editing.description ?? '' });
  }, [editing, editForm]);

  const createMutation = useMutation({
    mutationFn: (data: RequestTypeValues) => api.post('/api/request-types', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['request-types'] });
      setCreateOpen(false);
      createForm.reset();
      toast.success('Request type created');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating request type'),
  });

  const updateMutation = useMutation({
    mutationFn: (values: RequestTypeValues) => api.put(`/api/request-types/${editing!.id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['request-types'] });
      setEditing(null);
      toast.success('Request type updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating request type'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/api/request-types/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['request-types'] }),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Request Types</h1>
          <p className="text-sm text-muted-foreground">
            Every ticket is created from a template tied to one of these request types.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New Request Type
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Request Type</DialogTitle>
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
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input placeholder="e.g. Incident" {...field} /></FormControl>
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
                    <FormControl><Textarea placeholder="Optional" {...field} /></FormControl>
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

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Request Type</DialogTitle>
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
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
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
                    <FormControl><Textarea placeholder="Optional" {...field} /></FormControl>
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
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requestTypes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No request types yet.
                  </TableCell>
                </TableRow>
              )}
              {requestTypes.map((rt) => (
                <TableRow key={rt.id}>
                  <TableCell className="font-medium">{rt.name}</TableCell>
                  <TableCell className="text-muted-foreground">{rt.description || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={rt.isActive}
                        onCheckedChange={(checked) => toggleActive.mutate({ id: rt.id, isActive: checked })}
                      />
                      <Badge variant={rt.isActive ? 'success' : 'destructive'}>
                        {rt.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/admin/templates/${rt.id}`}>
                          <LayoutTemplate className="size-4" /> Template
                        </Link>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(rt)}>
                        <Pencil className="size-4" /> Edit
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
