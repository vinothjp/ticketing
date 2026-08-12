import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Boxes } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useConfirm } from '@/hooks/useConfirm';

interface StaffUser { id: string; username: string }
interface Consultant { id: string; track: 'TECHNICAL' | 'FUNCTIONAL'; rank: 'PRIMARY' | 'SECONDARY'; user: { id: string; username: string } }
interface ProductModule { id: string; name: string; consultants: Consultant[] }
interface Product { id: string; name: string; code: string; autoAssign: boolean; isActive: boolean; modules: ProductModule[] }

const NONE = '__none__';
const TRACKS = ['TECHNICAL', 'FUNCTIONAL'] as const;
const RANKS = ['PRIMARY', 'SECONDARY'] as const;

export default function ProductsPage() {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', code: '', autoAssign: true });
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

  const createProduct = useMutation({
    mutationFn: () => api.post('/api/products', { name: newProduct.name.trim(), code: newProduct.code.trim() || 'OTHERS', autoAssign: newProduct.autoAssign }),
    onSuccess: () => { invalidate(); setAddProductOpen(false); setNewProduct({ name: '', code: '', autoAssign: true }); toast.success('Product added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding product'),
  });
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
  const setConsultant = useMutation({
    mutationFn: (v: { moduleId: string; track: string; rank: string; userId: string | null }) =>
      api.put(`/api/products/modules/${v.moduleId}/consultant`, { track: v.track, rank: v.rank, userId: v.userId }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const slot = (m: ProductModule, track: string, rank: string) =>
    m.consultants.find((c) => c.track === track && c.rank === rank)?.user.id ?? NONE;

  // A consultant is a specialist for exactly one slot. Everyone already assigned
  // anywhere is off-limits — except the person currently in the slot being edited.
  const assignedUserIds = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.modules.forEach((m) => m.consultants.forEach((c) => set.add(c.user.id))));
    return set;
  }, [products]);
  const eligible = (currentUserId: string) =>
    staff.filter((u) => !assignedUserIds.has(u.id) || u.id === currentUserId);

  return (
    <div>
      {ConfirmDialog}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground">Products you support and the consultant handling each module. Customer tickets auto-route to the primary (or secondary if busy).</p>
        </div>
        <Button onClick={() => setAddProductOpen(true)}><Plus className="size-4" /> Add product</Button>
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
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  {p.name}
                  <Badge variant="secondary">{p.code}</Badge>
                  {p.autoAssign ? <Badge variant="outline">auto-assign</Badge> : <Badge variant="outline" className="text-muted-foreground">manual</Badge>}
                </CardTitle>
                <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                  onClick={async () => { if (await confirm({ title: `Delete ${p.name}?`, destructive: true, confirmText: 'Delete' })) removeProduct.mutate(p.id); }}>
                  <Trash2 className="size-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 pb-6">
                {!p.autoAssign && <p className="text-sm text-muted-foreground">Tickets for this product are assigned manually by an admin.</p>}

                {p.modules.map((m) => (
                  <div key={m.id} className="rounded-lg border p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="font-medium text-foreground">{m.name}</div>
                      <Button size="icon" variant="ghost" className="size-7 text-destructive hover:text-destructive" onClick={() => removeModule.mutate(m.id)}><Trash2 className="size-4" /></Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {TRACKS.map((track) => (
                        <div key={track} className="rounded-md bg-muted/30 p-2.5">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{track === 'TECHNICAL' ? 'Technical' : 'Functional'}</div>
                          <div className="space-y-2">
                            {RANKS.map((rank) => (
                              <div key={rank} className="flex items-center gap-2">
                                <span className="w-20 shrink-0 text-xs text-muted-foreground">{rank === 'PRIMARY' ? 'Primary' : 'Secondary'}</span>
                                <Select value={slot(m, track, rank)} onValueChange={(v) => setConsultant.mutate({ moduleId: m.id, track, rank, userId: v === NONE ? null : v })}>
                                  <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NONE}>Unassigned</SelectItem>
                                    {eligible(slot(m, track, rank)).map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {p.autoAssign && (
                  <div className="flex items-center gap-2">
                    <Input
                      className="max-w-xs"
                      placeholder={p.code === 'B1' ? 'e.g. Business One' : 'New module (e.g. FI, MM, SD)'}
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

      <Dialog open={addProductOpen} onOpenChange={setAddProductOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add product</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><div className="mb-1 text-sm">Name</div><Input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} placeholder="e.g. SAP Business One" /></div>
            <div>
              <div className="mb-1 text-sm">Type</div>
              <Select value={newProduct.code} onValueChange={(v) => setNewProduct({ ...newProduct, code: v, autoAssign: v !== 'OTHERS' })}>
                <SelectTrigger><SelectValue placeholder="Choose a type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="B1">SAP Business One (single set of consultants)</SelectItem>
                  <SelectItem value="S4HANA">SAP S/4HANA (consultants per module)</SelectItem>
                  <SelectItem value="OTHERS">Others (manual assignment)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddProductOpen(false)}>Cancel</Button>
            <Button disabled={!newProduct.name.trim() || !newProduct.code || createProduct.isPending} onClick={() => createProduct.mutate()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
