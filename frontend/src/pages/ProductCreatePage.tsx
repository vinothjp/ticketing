import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Boxes } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type Track = 'TECHNICAL' | 'FUNCTIONAL';
const TRACKS: Track[] = ['TECHNICAL', 'FUNCTIONAL'];
const trackLabel = (t: Track) => (t === 'TECHNICAL' ? 'Technical' : 'Functional');
interface DraftModule { name: string; tracks: Track[] }

// A professional on/off pill for a track (replaces the checkbox list).
function TrackPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-transparent text-muted-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

export default function ProductCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [autoAssign, setAutoAssign] = useState(true);
  const [modules, setModules] = useState<DraftModule[]>([]);
  const [moduleName, setModuleName] = useState('');

  const addModule = () => {
    const n = moduleName.trim();
    if (!n) return;
    if (modules.some((m) => m.name.toLowerCase() === n.toLowerCase())) {
      toast.error('That module is already listed');
      return;
    }
    setModules((ms) => [...ms, { name: n, tracks: ['TECHNICAL', 'FUNCTIONAL'] }]);
    setModuleName('');
  };
  const removeModule = (i: number) => setModules((ms) => ms.filter((_, idx) => idx !== i));
  const toggleTrack = (i: number, t: Track) =>
    setModules((ms) => ms.map((m, idx) => {
      if (idx !== i) return m;
      const has = m.tracks.includes(t);
      // Keep at least one track on a module.
      if (has && m.tracks.length === 1) return m;
      return { ...m, tracks: has ? m.tracks.filter((x) => x !== t) : [...m.tracks, t] };
    }));

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/products', {
        name: name.trim(),
        code: code.trim() || name.trim().slice(0, 12).toUpperCase(),
        description: description.trim() || undefined,
        autoAssign,
      });
      const productId = res.data.id as string;
      if (autoAssign) {
        for (const m of modules) {
          await api.post(`/api/products/${productId}/modules`, { name: m.name, tracks: m.tracks });
        }
      }
      return productId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product created');
      navigate('/admin/products');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating product'),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/products')} className="mb-3 -ml-2">
        <ArrowLeft className="size-4" /> All products
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">New product</h1>
        <p className="text-sm text-muted-foreground">Define the product, its modules, and which tracks each module handles.</p>
      </div>

      <div className="space-y-8">
        {/* Product details */}
        <section className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Product name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SAP Business One" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Code</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="B1" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description <span className="font-normal text-muted-foreground">(optional)</span></label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this product covers" />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium text-foreground">Auto-assign tickets</div>
              <div className="text-xs text-muted-foreground">Route customer tickets to the module's agents automatically. Turn off to assign manually.</div>
            </div>
            <Switch checked={autoAssign} onCheckedChange={setAutoAssign} />
          </div>
        </section>

        {/* Modules + per-module tracks */}
        {autoAssign && (
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Modules</h2>
              <p className="text-sm text-muted-foreground">Add each module and pick the tracks it uses. New modules start with both.</p>
            </div>

            {modules.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed py-8 text-center">
                <Boxes className="size-5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No modules yet. Add one below.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {modules.map((m, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <span className="font-medium text-foreground">{m.name}</span>
                    <div className="flex gap-2">
                      {TRACKS.map((t) => (
                        <TrackPill key={t} active={m.tracks.includes(t)} label={trackLabel(t)} onClick={() => toggleTrack(i, t)} />
                      ))}
                    </div>
                    <Button size="icon" variant="ghost" className="ml-auto size-8 text-destructive hover:text-destructive" onClick={() => removeModule(i)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Input
                className="max-w-xs"
                placeholder="Module name (e.g. FI, MM, SD)"
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addModule(); } }}
              />
              <Button variant="outline" size="sm" disabled={!moduleName.trim()} onClick={addModule}>
                <Plus className="size-3.5" /> Add module
              </Button>
            </div>
          </section>
        )}

        <div className="flex justify-end gap-2 border-t pt-5">
          <Button variant="outline" onClick={() => navigate('/admin/products')}>Cancel</Button>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create product'}
          </Button>
        </div>
      </div>
    </div>
  );
}
