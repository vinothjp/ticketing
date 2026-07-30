import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

interface AppForm { id: string; name: string; displayName: string; description?: string; }

const createFormSchema = z.object({
  name: z.string().min(1, 'System name is required'),
  displayName: z.string().min(1, 'Display name is required'),
  description: z.string().optional(),
});

type CreateFormValues = z.infer<typeof createFormSchema>;

export default function FormsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    defaultValues: { name: '', displayName: '', description: '' },
  });

  const { data: forms = [], isLoading } = useQuery<AppForm[]>({
    queryKey: ['forms'],
    queryFn: async () => (await api.get('/api/forms')).data,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateFormValues) => api.post('/api/forms', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms'] });
      setDialogOpen(false);
      form.reset();
      toast.success('Form registered');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error registering form'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/forms/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['forms'] }); toast.success('Form deleted'); },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Forms / Modules</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" /> Register Form
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register New Form</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>System Name</FormLabel>
                    <FormControl><Input placeholder="e.g. Invoices" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl><Input placeholder="e.g. Invoice Management" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
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
                  {createMutation.isPending ? 'Registering...' : 'Register'}
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
                <TableHead>System Name</TableHead>
                <TableHead>Display Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((f) => (
                <TableRow key={f.id}>
                  <TableCell><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{f.name}</code></TableCell>
                  <TableCell className="font-medium">{f.displayName}</TableCell>
                  <TableCell>{f.description || '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => { if (confirm('Delete form?')) deleteMutation.mutate(f.id); }}
                    >
                      Delete
                    </Button>
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
