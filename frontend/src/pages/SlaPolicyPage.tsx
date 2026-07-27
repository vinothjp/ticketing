import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface SlaPolicy {
  id: string;
  priority: string;
  responseHours: number | null;
  resolutionHours: number;
  isActive: boolean;
}
interface PicklistOption { value: string; label: string; }

const slaSchema = z.object({
  priority: z.string().min(1, 'Priority is required'),
  resolutionHours: z.number().int().min(1, 'Must be at least 1 hour'),
  responseHours: z.number().int().min(0).optional(),
});
type SlaValues = z.infer<typeof slaSchema>;

export default function SlaPolicyPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SlaPolicy | null>(null);

  const { data: policies = [], isLoading } = useQuery<SlaPolicy[]>({
    queryKey: ['sla-policies'],
    queryFn: async () => (await api.get('/api/sla-policies')).data,
  });
  const { data: priorities = [] } = useQuery<PicklistOption[]>({
    queryKey: ['picklist-options', 'priority'],
    queryFn: async () => (await api.get('/api/picklist-options', { params: { listKey: 'priority' } })).data,
  });

  const usedPriorities = new Set(policies.map((p) => p.priority));
  const availablePriorities = priorities.filter((p) => !usedPriorities.has(p.value));

  const createForm = useForm<SlaValues>({
    resolver: zodResolver(slaSchema),
    defaultValues: { priority: '', resolutionHours: 24, responseHours: 4 },
  });
  const editForm = useForm<SlaValues>({
    resolver: zodResolver(slaSchema),
    defaultValues: { priority: '', resolutionHours: 24, responseHours: 4 },
  });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({
      priority: editing.priority,
      resolutionHours: editing.resolutionHours,
      responseHours: editing.responseHours ?? 0,
    });
  }, [editing, editForm]);

  const createMutation = useMutation({
    mutationFn: (data: SlaValues) => api.post('/api/sla-policies', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
      setCreateOpen(false);
      createForm.reset({ priority: '', resolutionHours: 24, responseHours: 4 });
      toast.success('SLA policy created');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating SLA policy'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: SlaValues) =>
      api.put(`/api/sla-policies/${editing!.id}`, {
        resolutionHours: data.resolutionHours,
        responseHours: data.responseHours,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
      setEditing(null);
      toast.success('SLA policy updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating SLA policy'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/sla-policies/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
      toast.success('SLA policy deleted');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting SLA policy'),
  });

  const priorityLabel = (value: string) => priorities.find((p) => p.value === value)?.label ?? value;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SLA Policies</h1>
          <p className="text-sm text-muted-foreground">
            Set the resolution target per priority. New tickets auto-calculate their Due Date from this.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={availablePriorities.length === 0}>
          <Plus className="size-4" /> New policy
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New SLA policy</DialogTitle></DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField
                control={createForm.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select value={field.value || undefined} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Select priority..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {availablePriorities.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="resolutionHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Resolution target (hours)</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} value={field.value ?? ''} name={field.name} ref={field.ref} onBlur={field.onBlur}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="responseHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Response target (hours, optional)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} value={field.value ?? ''} name={field.name} ref={field.ref} onBlur={field.onBlur}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                    </FormControl>
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
          <DialogHeader><DialogTitle>Edit SLA — {editing && priorityLabel(editing.priority)}</DialogTitle></DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
              <FormField
                control={editForm.control}
                name="resolutionHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Resolution target (hours)</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} value={field.value ?? ''} name={field.name} ref={field.ref} onBlur={field.onBlur}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="responseHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Response target (hours, optional)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} value={field.value ?? ''} name={field.name} ref={field.ref} onBlur={field.onBlur}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.valueAsNumber)} />
                    </FormControl>
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
                <TableHead>Priority</TableHead>
                <TableHead>Response (h)</TableHead>
                <TableHead>Resolution (h)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">No SLA policies yet.</TableCell>
                </TableRow>
              )}
              {policies.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{priorityLabel(p.priority)}</TableCell>
                  <TableCell className="text-muted-foreground">{p.responseHours ?? '—'}</TableCell>
                  <TableCell>{p.resolutionHours}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                        <Pencil className="size-4" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { if (confirm(`Delete the ${priorityLabel(p.priority)} SLA policy?`)) removeMutation.mutate(p.id); }}
                      >
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
