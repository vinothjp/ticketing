import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ArrowUp, ArrowDown, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CR_OPTION_LISTS, type CrOption } from './changeRequestMeta';

export default function ChangeRequestOptionsPage() {
  const qc = useQueryClient();
  const [activeList, setActiveList] = useState(CR_OPTION_LISTS[0].key);
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');

  const { data: options = [], isLoading } = useQuery<CrOption[]>({
    queryKey: ['cr-options', activeList],
    queryFn: async () =>
      (await api.get('/api/change-requests/options', { params: { listKey: activeList } })).data,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['cr-options', activeList] });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/api/change-requests/options', {
        listKey: activeList,
        value: value.trim(),
        label: label.trim() || value.trim(),
        sortOrder: options.length,
      }),
    onSuccess: () => { invalidate(); setValue(''); setLabel(''); toast.success('Option added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding option'),
  });

  const updateMutation = useMutation({
    mutationFn: (opt: Partial<CrOption> & { id: string }) =>
      api.patch(`/api/change-requests/options/${opt.id}`, {
        value: opt.value, label: opt.label, isActive: opt.isActive, sortOrder: opt.sortOrder,
      }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating option'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/change-requests/options/${id}`),
    onSuccess: () => { invalidate(); toast.success('Option deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting option'),
  });

  const sorted = [...options].sort((a, b) => a.sortOrder - b.sortOrder);
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sorted.length) return;
    const a = sorted[index];
    const b = sorted[target];
    updateMutation.mutate({ id: a.id, sortOrder: b.sortOrder });
    updateMutation.mutate({ id: b.id, sortOrder: a.sortOrder });
  };

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2">
        <Link to="/change-requests"><ArrowLeft className="size-4" /> Change Requests</Link>
      </Button>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">CR Option Lists</h1>
        <p className="text-sm text-muted-foreground">
          Manage the dropdown values used across the Change Request module. These lists are private to
          Change Requests and independent of the ticketing Picklist Options.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {CR_OPTION_LISTS.map((l) => (
          <Button
            key={l.key}
            type="button"
            size="sm"
            variant={activeList === l.key ? 'default' : 'outline'}
            onClick={() => setActiveList(l.key)}
          >
            {l.label}
          </Button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-2 border-b pb-5">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Value</label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. High" className="w-48" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Label (optional)</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Defaults to value" className="w-48" />
        </div>
        <Button type="button" disabled={!value.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
          <Plus className="size-4" /> Add Option
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16" />
                <TableHead>Value</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">No options yet.</TableCell>
                </TableRow>
              )}
              {sorted.map((opt, i) => (
                <TableRow key={opt.id}>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={i === sorted.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{opt.value}</TableCell>
                  <TableCell>{opt.label}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={opt.isActive} onCheckedChange={(checked) => updateMutation.mutate({ id: opt.id, isActive: checked })} />
                      <Badge variant={opt.isActive ? 'success' : 'destructive'}>{opt.isActive ? 'Active' : 'Inactive'}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="destructive" onClick={() => { if (confirm('Delete option?')) deleteMutation.mutate(opt.id); }}>
                      <Trash2 className="size-4" /> Delete
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
