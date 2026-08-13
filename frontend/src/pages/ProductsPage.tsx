import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Boxes } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/hooks/useConfirm';
import { cn } from '@/lib/utils';

type Track = 'TECHNICAL' | 'FUNCTIONAL';
interface StaffUser { id: string; username: string }
interface Consultant { id: string; track: Track; isPrimary: boolean; sortOrder: number; user: { id: string; username: string } }
interface ProductModule { id: string; name: string; tracks: Track[]; consultants: Consultant[] }
interface Product { id: string; name: string; code: string; description?: string | null; autoAssign: boolean; isActive: boolean; modules: ProductModule[] }

const TRACKS: Track[] = ['TECHNICAL', 'FUNCTIONAL'];
const trackLabel = (t: Track) => (t === 'TECHNICAL' ? 'Technical' : 'Functional');

// A professional on/off pill for a track (replaces the checkbox list).
function TrackPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-transparent text-muted-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

export default function ProductsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [newModule, setNewModule] = useState<Record<string, string>>({});

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/api/products')).data,
  });
  const { data: staff = [] } = useQuery<StaffUser[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/api/users')).data,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['products'] });

  const removeProduct = useMutation({
    mutationFn: (id: string) => api.delete(`/api/products/${id}`),
    onSuccess: () => { invalidate(); toast.success('Product deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const addModule = useMutation({
    mutationFn: (v: { productId: string; name: string }) => api.post(`/api/products/${v.productId}/modules`, { name: v.name }),
    onSuccess: (_r, v) => { invalidate(); setNewModule((s) => ({ ...s, [v.productId]: '' })); toast.success('Module added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const removeModule = useMutation({
    mutationFn: (moduleId: string) => api.delete(`/api/products/modules/${moduleId}`),
    onSuccess: () => { invalidate(); toast.success('Module removed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const updateModuleTracks = useMutation({
    mutationFn: (v: { moduleId: string; tracks: Track[] }) => api.patch(`/api/products/modules/${v.moduleId}`, { tracks: v.tracks }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const addConsultant = useMutation({
    mutationFn: (v: { moduleId: string; track: Track; userId: string }) =>
      api.post(`/api/products/modules/${v.moduleId}/consultants`, { track: v.track, userId: v.userId }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const removeConsultant = useMutation({
    mutationFn: (v: { moduleId: string; consultantId: string }) =>
      api.delete(`/api/products/modules/${v.moduleId}/consultants/${v.consultantId}`),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const setPrimary = useMutation({
    mutationFn: (v: { moduleId: string; consultantId: string }) =>
      api.put(`/api/products/modules/${v.moduleId}/consultants/${v.consultantId}/primary`),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  // A consultant is a specialist for exactly one module/track. Everyone already
  // assigned anywhere is off-limits for new lists.
  const assignedUserIds = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.modules.forEach((m) => m.consultants.forEach((c) => set.add(c.user.id))));
    return set;
  }, [products]);
  const eligibleStaff = staff.filter((u) => !assignedUserIds.has(u.id));

  const agentsFor = (m: ProductModule, track: Track) =>
    m.consultants
      .filter((c) => c.track === track)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);

  const toggleModuleTrack = async (m: ProductModule, t: Track) => {
    const has = m.tracks.includes(t);
    if (has && m.tracks.length === 1) return;                 // keep at least one track
    const next = has ? m.tracks.filter((x) => x !== t) : [...m.tracks, t];
    if (has && agentsFor(m, t).length > 0) {
      const ok = await confirm({ title: `Turn off ${trackLabel(t)} for ${m.name}?`, description: 'Agents listed under this track will be removed.', destructive: true, confirmText: 'Turn off' });
      if (!ok) return;
    }
    updateModuleTracks.mutate({ moduleId: m.id, tracks: next });
  };

  return (
    <div>
      {ConfirmDialog}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground">Products you support and the agents handling each module. Customer tickets auto-route to the primary agent (or the next free one).</p>
        </div>
        <Button onClick={() => navigate('/admin/products/new')}><Plus className="size-4" /> Add product</Button>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading…</p> : products.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Boxes className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No products yet.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {products.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {p.name}
                    <Badge variant="secondary">{p.code}</Badge>
                    {p.autoAssign ? <Badge variant="outline">auto-assign</Badge> : <Badge variant="outline" className="text-muted-foreground">manual</Badge>}
                  </CardTitle>
                  {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
                </div>
                <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                  onClick={async () => { if (await confirm({ title: `Delete ${p.name}?`, destructive: true, confirmText: 'Delete' })) removeProduct.mutate(p.id); }}>
                  <Trash2 className="size-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 pb-6">
                {!p.autoAssign && <p className="text-sm text-muted-foreground">Tickets for this product are assigned manually by an admin.</p>}

                {p.autoAssign && p.modules.map((m) => (
                  <div key={m.id} className="rounded-lg border p-3">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                      <div className="font-medium text-foreground">{m.name}</div>
                      {/* Per-module track toggles */}
                      <div className="flex gap-2">
                        {TRACKS.map((t) => (
                          <TrackPill key={t} active={m.tracks.includes(t)} label={trackLabel(t)} onClick={() => toggleModuleTrack(m, t)} />
                        ))}
                      </div>
                      <Button size="icon" variant="ghost" className="ml-auto size-7 text-destructive hover:text-destructive" onClick={() => removeModule.mutate(m.id)}><Trash2 className="size-4" /></Button>
                    </div>
                    <div className={`grid gap-3 ${m.tracks.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                      {TRACKS.filter((t) => m.tracks.includes(t)).map((track) => {
                        const agents = agentsFor(m, track);
                        const takenHere = new Set(agents.map((a) => a.user.id));
                        const addable = eligibleStaff.filter((u) => !takenHere.has(u.id));
                        return (
                          <div key={track} className="rounded-md bg-muted/30 p-2.5">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{trackLabel(track)}</div>
                            <div className="space-y-1.5">
                              {agents.length === 0 && <p className="text-xs text-muted-foreground">No agents yet — the first you add becomes primary.</p>}
                              {agents.map((a) => (
                                <div key={a.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                                  <span className="flex-1 truncate text-sm text-foreground">
                                    {a.user.username}
                                    {a.isPrimary && <span className="ml-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">(primary)</span>}
                                  </span>
                                  {!a.isPrimary && (
                                    <button className="text-xs text-muted-foreground hover:text-foreground" title="Make this agent the primary"
                                      onClick={() => setPrimary.mutate({ moduleId: m.id, consultantId: a.id })}>
                                      Make primary
                                    </button>
                                  )}
                                  <Button size="icon" variant="ghost" className="size-6 text-destructive hover:text-destructive"
                                    onClick={() => removeConsultant.mutate({ moduleId: m.id, consultantId: a.id })}>
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              ))}
                              <Select value="" onValueChange={(v) => addConsultant.mutate({ moduleId: m.id, track, userId: v })}>
                                <SelectTrigger className="h-8"><SelectValue placeholder="+ Add agent" /></SelectTrigger>
                                <SelectContent>
                                  {addable.length === 0
                                    ? <SelectItem value="__none" disabled>No unassigned staff</SelectItem>
                                    : addable.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {p.autoAssign && (
                  <div className="flex items-center gap-2">
                    <Input
                      className="max-w-xs"
                      placeholder="New module (e.g. FI, MM, SD)"
                      value={newModule[p.id] ?? ''}
                      onChange={(e) => setNewModule((s) => ({ ...s, [p.id]: e.target.value }))}
                    />
                    <Button size="sm" variant="outline" disabled={!(newModule[p.id] ?? '').trim()} onClick={() => addModule.mutate({ productId: p.id, name: (newModule[p.id] ?? '').trim() })}>
                      <Plus className="size-3.5" /> Add module
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
