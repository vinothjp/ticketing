import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { CURRENCIES } from '@/lib/currencies';
import {
  PROJECT_STATUSES, PRIORITIES, labelOf,
  type UserOption, type CustomerCompanyOption,
} from './projectMeta';

const NONE = '__none__';

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  key: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(PROJECT_STATUSES),
  priority: z.string().optional(),
  managerUserId: z.string().optional(),
  customerCompanyId: z.string().optional(),
  projectTemplateId: z.string().optional(),
  budget: z.string().optional(),
  currency: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
type CreateValues = z.infer<typeof createSchema>;

export default function ProjectCreatePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: '', key: '', description: '', status: 'OPEN',
      priority: '', managerUserId: '', customerCompanyId: '', projectTemplateId: '', budget: '', currency: 'USD', startDate: '', endDate: '',
    },
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  const { data: companies = [] } = useQuery<CustomerCompanyOption[]>({
    queryKey: ['customer-companies'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
  });
  const { data: projectTemplates = [] } = useQuery<{ id: string; name: string; isActive: boolean }[]>({
    queryKey: ['project-templates'],
    queryFn: async () => (await api.get('/api/project-templates')).data,
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateValues) => api.post('/api/projects', {
      name: values.name,
      key: values.key || undefined,
      description: values.description || undefined,
      status: values.status,
      priority: values.priority || undefined,
      managerUserId: values.managerUserId || undefined,
      customerCompanyId: values.customerCompanyId || undefined,
      projectTemplateId: values.projectTemplateId || undefined,
      budget: values.budget ? Number(values.budget) : undefined,
      currency: values.currency || undefined,
      startDate: values.startDate || undefined,
      endDate: values.endDate || undefined,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created');
      navigate(`/projects/${res.data.id}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating project'),
  });

  return (
    <div className="w-full">
      <Button variant="ghost" size="sm" onClick={() => navigate('/projects')} className="mb-1 -ml-2">
        <ArrowLeft className="size-4" /> All projects
      </Button>

      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">New Project</h1>
        <p className="text-sm text-muted-foreground">Set up the project. Only the name is required.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="key" render={({ field }) => (
              <FormItem>
                <FormLabel>Key</FormLabel>
                <FormControl><Input placeholder="e.g. WEB" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger className="w-full"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
          </div>

          <FormField control={form.control} name="description" render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl><Textarea rows={4} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField control={form.control} name="priority" render={({ field }) => (
              <FormItem>
                <FormLabel>Priority</FormLabel>
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                  <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{labelOf(p)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name="managerUserId" render={({ field }) => (
              <FormItem>
                <FormLabel>Manager</FormLabel>
                <Combobox
                  placeholder="Unassigned" emptyText="No matching user"
                  value={field.value || ''}
                  onChange={field.onChange}
                  options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.username }))]}
                />
              </FormItem>
            )} />
            <FormField control={form.control} name="customerCompanyId" render={({ field }) => (
              <FormItem>
                <FormLabel>Customer Company</FormLabel>
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                  <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name="projectTemplateId" render={({ field }) => (
              <FormItem>
                <FormLabel>Project template</FormLabel>
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? '' : v)}>
                  <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="None (blank project)" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={NONE}>None (blank project)</SelectItem>
                    {projectTemplates.filter((t) => t.isActive).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name="budget" render={({ field }) => (
              <FormItem>
                <FormLabel>Budget</FormLabel>
                <FormControl><Input type="number" min="0" placeholder="0" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="currency" render={({ field }) => (
              <FormItem>
                <FormLabel>Currency</FormLabel>
                <Select value={field.value || 'USD'} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="USD" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="startDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date</FormLabel>
                <FormControl><DateField value={field.value} onChange={field.onChange} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="endDate" render={({ field }) => (
              <FormItem>
                <FormLabel>End Date</FormLabel>
                <FormControl><DateField value={field.value} onChange={field.onChange} min={form.watch('startDate') || undefined} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={() => navigate('/projects')}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
