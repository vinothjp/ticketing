import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2, X, Upload, Star } from 'lucide-react';
import api from '../lib/api';
import ProductIcon from '@/components/ProductIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type Track = 'TECHNICAL' | 'FUNCTIONAL' | 'OTHERS';
const COLS: { key: Track; label: string }[] = [
  { key: 'TECHNICAL', label: 'Technical' },
  { key: 'FUNCTIONAL', label: 'Functional' },
  { key: 'OTHERS', label: 'Others' },
];
const inCol = (agents: Agent[], col: Track) =>
  col === 'OTHERS' ? agents.filter((a) => a.track !== 'TECHNICAL' && a.track !== 'FUNCTIONAL') : agents.filter((a) => a.track === col);

interface StaffUser { id: string; username: string }
interface Agent { id: string; track: string; isPrimary: boolean; user: { id: string; username: string } }
interface Module { id: string; name: string; consultants: Agent[] }
interface Product { id: string; name: string; code: string; description?: string | null; imageUrl?: string | null; consultants: Agent[]; modules: Module[] }

interface DraftLink { track: string; userId: string }
interface DraftModule { key: string; name: string; agents: DraftLink[] }
const CID = '::';
const addLink = (list: DraftLink[], t: string, userId: string) => (list.some((a) => a.track === t && a.userId === userId) ? list : [...list, { track: t, userId }]);
const removeLink = (list: DraftLink[], cid: string) => { const [track, userId] = cid.split(CID); return list.filter((a) => !(a.track === track && a.userId === userId)); };
const primaryLink = (list: DraftLink[], cid: string) => {
  const [track, userId] = cid.split(CID);
  const target = list.find((a) => a.track === track && a.userId === userId);
  if (!target) return list;
  const rest = list.filter((a) => !(a.track === track && a.userId === userId));
  const at = rest.findIndex((a) => a.track === track);
  return [...rest.slice(0, at === -1 ? rest.length : at), target, ...rest.slice(at === -1 ? rest.length : at)];
};
function draftAgents(list: DraftLink[], staff: StaffUser[]): Agent[] {
  const seen = new Set<string>();
  return list.map((a) => {
    const isPrimary = !seen.has(a.track); seen.add(a.track);
    return { id: `${a.track}${CID}${a.userId}`, track: a.track, isPrimary, user: { id: a.userId, username: staff.find((s) => s.id === a.userId)?.username ?? a.userId } };
  });
}

export default function ProductEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [details, setDetails] = useState({ name: '', code: '', description: '' });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [newModule, setNewModule] = useState('');
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'PRODUCT' | 'MODULES'>('PRODUCT');
  const [dAgents, setDAgents] = useState<DraftLink[]>([]);
  const [dModules, setDModules] = useState<DraftModule[]>([]);

  const { data: product } = useQuery<Product>({ queryKey: ['product', id], queryFn: async () => (await api.get(`/api/products/${id}`)).data, enabled: !isNew });
  const { data: staff = [] } = useQuery<StaffUser[]>({ queryKey: ['users'], queryFn: async () => (await api.get('/api/users')).data });

  useEffect(() => {
    if (product) {
      setDetails({ name: product.name, code: product.code, description: product.description ?? '' });
      setImageUrl(product.imageUrl ?? null);
      setMode(product.modules.length > 0 ? 'MODULES' : 'PRODUCT');
    }
  }, [product]);

  const refetch = () => qc.invalidateQueries({ queryKey: ['product', id] });
  const call = async (p: Promise<unknown>, ok?: string) => { try { await p; if (!isNew) refetch(); if (ok) toast.success(ok); } catch (e: any) { toast.error(e.response?.data?.message || 'Error'); } };

  const saveDetails = () => call(api.patch(`/api/products/${id}`, { name: details.name.trim(), code: details.code.trim(), description: details.description.trim() }), 'Saved');
  const onPickImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Choose an image file'); return; }
    if (file.size > 512 * 1024) { toast.error('Image must be under 500 KB'); return; }
    const reader = new FileReader();
    reader.onload = () => { const url = reader.result as string; setImageUrl(url); if (!isNew) call(api.patch(`/api/products/${id}`, { imageUrl: url }), 'Logo updated'); };
    reader.readAsDataURL(file);
  };
  const removeImage = () => { setImageUrl(null); if (!isNew) call(api.patch(`/api/products/${id}`, { imageUrl: null })); };

  const createProduct = async () => {
    if (!details.name.trim() || !details.code.trim()) return;
    setSaving(true);
    try {
      const res = await api.post('/api/products', { name: details.name.trim(), code: details.code.trim(), description: details.description.trim() || undefined, imageUrl: imageUrl || undefined });
      const pid = res.data.id as string;
      if (mode === 'PRODUCT') {
        for (const a of dAgents) await api.post(`/api/products/${pid}/consultants`, { track: a.track, userId: a.userId });
      } else {
        for (const m of dModules) {
          const mid = (await api.post(`/api/products/${pid}/modules`, { name: m.name, tracks: [] })).data.id;
          for (const a of m.agents) await api.post(`/api/products/modules/${mid}/consultants`, { track: a.track, userId: a.userId });
        }
      }
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product created');
      navigate('/admin/products');
    } catch (e: any) { toast.error(e.response?.data?.message || 'Error'); setSaving(false); }
  };

  // Grid data + handlers
  const productAgents = isNew ? draftAgents(dAgents, staff) : product?.consultants ?? [];
  const modules: Module[] = isNew ? dModules.map((m) => ({ id: m.key, name: m.name, consultants: draftAgents(m.agents, staff) })) : product?.modules ?? [];
  const patchDMod = (key: string, fn: (m: DraftModule) => DraftModule) => setDModules((ms) => ms.map((m) => (m.key === key ? fn(m) : m)));

  const addProductAgent = (track: Track, uid: string) => (isNew ? setDAgents(addLink(dAgents, track, uid)) : call(api.post(`/api/products/${id}/consultants`, { track, userId: uid })));
  const removeProductAgent = (cid: string) => (isNew ? setDAgents(removeLink(dAgents, cid)) : call(api.delete(`/api/products/${id}/consultants/${cid}`)));
  const productPrimary = (cid: string) => (isNew ? setDAgents(primaryLink(dAgents, cid)) : call(api.put(`/api/products/${id}/consultants/${cid}/primary`)));
  const addModuleAgent = (mid: string, track: Track, uid: string) => (isNew ? patchDMod(mid, (m) => ({ ...m, agents: addLink(m.agents, track, uid) })) : call(api.post(`/api/products/modules/${mid}/consultants`, { track, userId: uid })));
  const removeModuleAgent = (mid: string, cid: string) => (isNew ? patchDMod(mid, (m) => ({ ...m, agents: removeLink(m.agents, cid) })) : call(api.delete(`/api/products/modules/${mid}/consultants/${cid}`)));
  const modulePrimary = (mid: string, cid: string) => (isNew ? patchDMod(mid, (m) => ({ ...m, agents: primaryLink(m.agents, cid) })) : call(api.put(`/api/products/modules/${mid}/consultants/${cid}/primary`)));
  const removeModule = (mid: string) => (isNew ? setDModules(dModules.filter((m) => m.key !== mid)) : call(api.delete(`/api/products/modules/${mid}`)));
  const addModule = () => {
    const name = newModule.trim(); if (!name) return;
    if (isNew) { setDModules([...dModules, { key: `d${Date.now()}`, name, agents: [] }]); setNewModule(''); }
    else call(api.post(`/api/products/${id}/modules`, { name, tracks: [] })).then(() => setNewModule(''));
  };

  const canSave = isNew ? !!(details.name.trim() && details.code.trim()) : true;
  const showStructure = isNew || !!product;

  return (
    <div>
      <div className="sticky top-14 z-10 -mx-8 -mt-8 mb-5 flex items-center justify-between border-b bg-background/95 px-8 py-3 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/products')} className="-ml-2"><ArrowLeft className="size-4" /> All products</Button>
        <Button disabled={!canSave || saving} onClick={isNew ? createProduct : saveDetails}>{isNew ? (saving ? 'Creating…' : 'Create') : 'Save'}</Button>
      </div>

      <h1 className="mb-5 text-2xl font-bold text-foreground">{isNew ? 'New product' : product?.name ?? 'Product'}</h1>

      <div className="space-y-6">
        <section className="space-y-4">
          <div className="flex items-center gap-4">
            <ProductIcon imageUrl={imageUrl} className="size-16" />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Logo <span className="font-normal text-muted-foreground">(optional)</span></label>
              <div className="flex items-center gap-2">
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted">
                  <Upload className="size-3.5" /> {imageUrl ? 'Change image' : 'Upload image'}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => onPickImage(e.target.files?.[0])} />
                </label>
                {imageUrl && <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={removeImage}>Remove</Button>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Product name</label>
              <Input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} placeholder="e.g. SAP Business One" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Code</label>
              <Input value={details.code} onChange={(e) => setDetails({ ...details, code: e.target.value })} placeholder="B1" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description <span className="font-normal text-muted-foreground">(optional)</span></label>
            <Textarea rows={2} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} />
          </div>
        </section>

        {showStructure && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Assign consultants</label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'PRODUCT' | 'MODULES')} className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="PRODUCT" /> Whole product</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="MODULES" /> Modules</label>
              </RadioGroup>
            </div>

            {mode === 'PRODUCT' ? (
              <section className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">Agents</h2>
                <p className="text-sm text-muted-foreground">Type an agent's name in a cell to assign them.</p>
                <AgentGrid
                  rows={[{ key: '__p', name: null, agents: productAgents }]}
                  staff={staff}
                  onAdd={(_, t, uid) => addProductAgent(t, uid)}
                  onRemove={(_, cid) => removeProductAgent(cid)}
                  onPrimary={(_, cid) => productPrimary(cid)}
                />
              </section>
            ) : (
              <section className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">Modules</h2>
                <p className="text-sm text-muted-foreground">Each module row has its own agents per track. Type a name to assign.</p>
                <AgentGrid
                  showModuleCol
                  rows={modules.map((m) => ({ key: m.id, name: m.name, agents: m.consultants, removable: true }))}
                  staff={staff}
                  onAdd={(mid, t, uid) => addModuleAgent(mid, t, uid)}
                  onRemove={(mid, cid) => removeModuleAgent(mid, cid)}
                  onPrimary={(mid, cid) => modulePrimary(mid, cid)}
                  onRemoveRow={removeModule}
                  addRow={{ value: newModule, onChange: setNewModule, onAdd: addModule }}
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---- grid ----
function AgentGrid({
  rows, staff, showModuleCol, onAdd, onRemove, onPrimary, onRemoveRow, addRow,
}: {
  rows: { key: string; name: string | null; agents: Agent[]; removable?: boolean }[];
  staff: StaffUser[]; showModuleCol?: boolean;
  onAdd: (rowKey: string, track: Track, userId: string) => void;
  onRemove: (rowKey: string, cid: string) => void;
  onPrimary: (rowKey: string, cid: string) => void;
  onRemoveRow?: (rowKey: string) => void;
  addRow?: { value: string; onChange: (v: string) => void; onAdd: () => void };
}) {
  const colCount = (showModuleCol ? 1 : 0) + COLS.length;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {showModuleCol && <th className="w-44 border-b px-3 py-2">Module</th>}
            {COLS.map((c) => <th key={c.key} className="border-b border-l px-3 py-2">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="align-top">
              {showModuleCol && (
                <td className="border-b px-3 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium text-foreground">{row.name}</span>
                    {row.removable && onRemoveRow && (
                      <button className="text-muted-foreground hover:text-destructive" onClick={() => onRemoveRow(row.key)}><Trash2 className="size-3.5" /></button>
                    )}
                  </div>
                </td>
              )}
              {COLS.map((c) => {
                const list = inCol(row.agents, c.key).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
                const taken = new Set(list.map((a) => a.user.id));
                return (
                  <td key={c.key} className="border-b border-l px-2 py-2 align-top">
                    <div className="space-y-1">
                      {list.map((a) => (
                        <div key={a.id} className="group flex items-center gap-1 rounded bg-muted px-1.5 py-1 text-xs">
                          {a.isPrimary
                            ? <Star className="size-3 shrink-0 fill-amber-500 text-amber-500" />
                            : <button title="Make primary" className="shrink-0 text-muted-foreground hover:text-amber-500" onClick={() => onPrimary(row.key, a.id)}><Star className="size-3" /></button>}
                          <span className="flex-1 truncate text-foreground">{a.user.username}</span>
                          <button className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onRemove(row.key, a.id)}><X className="size-3" /></button>
                        </div>
                      ))}
                      <AgentTypeahead staff={staff} exclude={taken} onPick={(uid) => onAdd(row.key, c.key, uid)} />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          {addRow && (
            <tr>
              <td className="px-3 py-2" colSpan={colCount}>
                <div className="flex items-center gap-2">
                  <Input className="h-8 max-w-xs" placeholder="New module (e.g. FI, MM, SD)" value={addRow.value}
                    onChange={(e) => addRow.onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRow.onAdd(); } }} />
                  <Button size="sm" variant="outline" disabled={!addRow.value.trim()} onClick={addRow.onAdd}><Plus className="size-3.5" /> Add module</Button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Type-to-search agent picker. The dropdown is portalled to <body> with fixed
// positioning so it isn't clipped by the table's overflow (flips up near the edge).
function AgentTypeahead({ staff, exclude, onPick }: { staff: StaffUser[]; exclude: Set<string>; onPick: (userId: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const matches = staff.filter((u) => !exclude.has(u.id) && u.username.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);

  const reposition = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const DROP_H = 200;
    const below = window.innerHeight - r.bottom;
    const openUp = below < DROP_H + 8 && r.top > below;
    setPos(openUp
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
      : { left: r.left, width: r.width, top: r.bottom + 4 });
  };
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const h = () => reposition();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    return () => { window.removeEventListener('scroll', h, true); window.removeEventListener('resize', h); };
  }, [open, q]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="+ type agent…"
        className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-primary"
      />
      {open && matches.length > 0 && pos && createPortal(
        <div
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, zIndex: 50 }}
          className="max-h-48 min-w-36 overflow-y-auto rounded-md border bg-popover shadow-md">
          {matches.map((u) => (
            <button key={u.id} className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-muted" onMouseDown={(e) => { e.preventDefault(); onPick(u.id); setQ(''); }}>
              {u.username}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
