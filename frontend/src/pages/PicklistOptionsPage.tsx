import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface PicklistOption {
  id: string;
  listKey: string;
  value: string;
  label: string;
  parentValue?: string | null;
  isActive: boolean;
  sortOrder: number;
}

const LISTS: { key: string; label: string; hasParent?: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'ticketStatus', label: 'Ticket Status' },
  { key: 'department', label: 'Department' },
  { key: 'ticketCategory', label: 'Ticket Category' },
  { key: 'subCategory', label: 'Sub Category', hasParent: 'ticketCategory' },
];

export default function PicklistOptionsPage() {
  const qc = useQueryClient();
  const [activeList, setActiveList] = useState(LISTS[0].key);
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [parentValue, setParentValue] = useState<string>('');

  const activeListDef = LISTS.find((l) => l.key === activeList)!;

  const { data: options = [], isLoading } = useQuery<PicklistOption[]>({
    queryKey: ['picklist-options', activeList],
    queryFn: async () => (await api.get('/api/picklist-options', { params: { listKey: activeList } })).data,
  });

  const { data: parentOptions = [] } = useQuery<PicklistOption[]>({
    queryKey: ['picklist-options', activeListDef.hasParent],
    queryFn: async () =>
      (await api.get('/api/picklist-options', { params: { listKey: activeListDef.hasParent } })).data,
    enabled: !!activeListDef.hasParent,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/api/picklist-options', {
        listKey: activeList,
        value,
        label,
        parentValue: activeListDef.hasParent ? parentValue : undefined,
        sortOrder: options.length,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picklist-options', activeList] });
      setValue('');
      setLabel('');
      setParentValue('');
      toast.success('Option added');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding option'),
  });

  const updateMutation = useMutation({
    mutationFn: (opt: PicklistOption) =>
      api.put(`/api/picklist-options/${opt.id}`, {
        listKey: opt.listKey,
        value: opt.value,
        label: opt.label,
        parentValue: opt.parentValue ?? undefined,
        isActive: opt.isActive,
        sortOrder: opt.sortOrder,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['picklist-options', activeList] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/picklist-options/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['picklist-options', activeList] });
      toast.success('Option deleted');
    },
  });

  const move = (index: number, dir: -1 | 1) => {
    const sorted = [...options].sort((a, b) => a.sortOrder - b.sortOrder);
    const target = index + dir;
    if (target < 0 || target >= sorted.length) return;
    const a = sorted[index];
    const b = sorted[target];
    updateMutation.mutate({ ...a, sortOrder: b.sortOrder });
    updateMutation.mutate({ ...b, sortOrder: a.sortOrder });
  };

  const sortedOptions = [...options].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Picklist Options</h1>
        <p className="text-sm text-muted-foreground">
          Manage the dropdown values used by Priority, Ticket Status, Category, Sub Category, and
          Department fields across all templates.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {LISTS.map((l) => (
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
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. high" className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Label</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. High" className="w-40" />
        </div>
        {activeListDef.hasParent && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Parent Category</label>
            <Select value={parentValue} onValueChange={setParentValue}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {parentOptions.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button
          type="button"
          disabled={!value || !label || (!!activeListDef.hasParent && !parentValue) || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
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
                {activeListDef.hasParent && <TableHead>Parent</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOptions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No options yet.
                  </TableCell>
                </TableRow>
              )}
              {sortedOptions.map((opt, i) => (
                <TableRow key={opt.id}>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn('h-6 w-6')}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={i === sortedOptions.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{opt.value}</TableCell>
                  <TableCell>{opt.label}</TableCell>
                  {activeListDef.hasParent && <TableCell className="text-muted-foreground">{opt.parentValue || '—'}</TableCell>}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={opt.isActive}
                        onCheckedChange={(checked) => updateMutation.mutate({ ...opt, isActive: checked })}
                      />
                      <Badge variant={opt.isActive ? 'success' : 'destructive'}>
                        {opt.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => { if (confirm('Delete option?')) deleteMutation.mutate(opt.id); }}
                    >
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
