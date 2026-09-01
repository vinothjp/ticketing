import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus, List, HardDrive } from 'lucide-react';
import api from '../../lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOptionValues } from '@/lib/optionLists';
import {
  ASSET_STATES, assetStatePill, assetTypeIcon, groupAssetsByType,
} from './assetMeta';
import type { Asset, AssetState, AssetTypeGroup } from './assetMeta';

const ALL = '__all__';

/**
 * Asset Master, organised the way a register is actually read: one card per
 * asset **type**, each carrying that type's headcount split across In use / In
 * store / In repair / Others. A flat table sorted by asset id answers "what is
 * asset LAP-0417"; this answers "how many laptops do we have and where are
 * they", which is the question a master screen exists for. The table is still
 * one click away, and every figure on a card is a link into it, pre-filtered.
 *
 * The split is derived from the same `GET /api/assets` payload the table reads —
 * it already carries each asset's open allocation — so the counts here can never
 * disagree with the rows they drill into.
 */
export default function AssetOverviewPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(ALL);

  const { data: assets = [], isLoading } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: async () => (await api.get('/api/assets')).data,
  });

  // Every type the tenant has registered, so a type with nothing in it still
  // gets a card. Categories drive the filter beside the heading.
  const listedTypes = useOptionValues('assetType');
  const listedCategories = useOptionValues('assetCategory');

  const inCategory = useMemo(
    () => (category === ALL ? assets : assets.filter((a) => (a.assetCategory ?? '') === category)),
    [assets, category],
  );

  const groups = useMemo(() => {
    // Filtering by category narrows which *types* can appear, so an empty card
    // is only offered when that type could hold something in this category.
    const types = category === ALL
      ? listedTypes
      : [...new Set(inCategory.map((a) => a.assetType?.trim()).filter(Boolean) as string[])];
    const all = groupAssetsByType(inCategory, types);
    const term = q.trim().toLowerCase();
    return term ? all.filter((g) => g.label.toLowerCase().includes(term)) : all;
  }, [inCategory, listedTypes, category, q]);

  const totals = useMemo(
    () => groups.reduce((sum, g) => sum + g.total, 0),
    [groups],
  );

  const openList = (type: string, state?: AssetState) => {
    const p = new URLSearchParams();
    if (type) p.set('type', type); else p.set('type', '__none__');
    if (state) p.set('state', state);
    navigate(`/admin/assets?${p}`);
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assets by type</h1>
          <p className="text-sm text-muted-foreground">
            {totals} {totals === 1 ? 'asset' : 'assets'} across {groups.length}{' '}
            {groups.length === 1 ? 'type' : 'types'}. Each asset is one physical unit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/admin/assets')}>
            <List className="size-4" /> All assets
          </Button>
          <Button onClick={() => navigate('/admin/assets/new')}>
            <Plus className="size-4" /> New asset
          </Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset types…" className="pl-8" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter by category</span>
          <Select value={category} onValueChange={(v) => { if (v) setCategory(v); }}>
            <SelectTrigger className="w-56 [&>span]:min-w-0 [&>span]:truncate">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {listedCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <HardDrive className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {q || category !== ALL ? 'No asset types match your filters.' : 'No assets in the register yet.'}
          </p>
          {!q && category === ALL && (
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/assets/new')}>
              <Plus className="size-4" /> Add the first asset
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {groups.map((g) => (
            <TypeCard key={g.type || '__none__'} group={g} onOpen={openList} />
          ))}
        </div>
      )}
    </div>
  );
}

function TypeCard({
  group, onOpen,
}: {
  group: AssetTypeGroup;
  onOpen: (type: string, state?: AssetState) => void;
}) {
  const navigate = useNavigate();
  const Icon = assetTypeIcon(group.type);
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border transition-colors hover:border-primary/40">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <button
          type="button"
          onClick={() => onOpen(group.type)}
          className="min-w-0 flex-1 text-left text-sm font-semibold text-foreground hover:underline"
          title={`Open ${group.label}`}
        >
          <span className="block truncate">
            {group.label} <span className="font-normal text-muted-foreground">({group.total})</span>
          </span>
        </button>
        {/* Adding from the card carries the type through, so the one field the
            card already knows is not retyped on the form. */}
        <Button
          size="icon" variant="ghost" className="size-7 shrink-0 text-primary hover:text-primary"
          title={`Add a ${group.label} asset`}
          onClick={() => navigate(`/admin/assets/new${group.type ? `?type=${encodeURIComponent(group.type)}` : ''}`)}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="flex flex-1 items-center gap-3 p-3">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground">
          <Icon className="size-8" strokeWidth={1.5} />
        </div>
        {/* Each figure is a link into the filtered table — the count and the rows
            behind it come from the same payload, so they cannot disagree. */}
        <dl className="min-w-0 flex-1 border-l pl-3 text-sm">
          {ASSET_STATES.map((s) => {
            const n = group.counts[s.value];
            return (
              <div key={s.value} className="flex items-center justify-between gap-2 py-0.5">
                <dt className="truncate text-muted-foreground">{s.label}</dt>
                <dd>
                  <button
                    type="button"
                    disabled={n === 0}
                    onClick={() => onOpen(group.type, s.value)}
                    className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                      n === 0 ? 'text-muted-foreground' : `${assetStatePill(s.value)} hover:underline`
                    }`}
                    title={n === 0 ? undefined : `Show ${n} ${group.label} · ${s.label}`}
                  >
                    {n}
                  </button>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}
