import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Plus, Pencil, Trash2, Barcode, Package, Tag, Layers, Hash, UserRound, HardDrive,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../../lib/api';
import { useConfirm } from '@/hooks/useConfirm';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { allocationStatusLabel, allocationStatusPill } from '../employees/employeeMeta';
import type { Asset } from './assetMeta';

/** The asset register: one row per physical unit, and who is holding it. */
export default function AssetListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const [q, setQ] = useState('');

  const { data: assets = [], isLoading } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: async () => (await api.get('/api/assets')).data,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/assets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['asset-allocations'] });
      toast.success('Asset deleted');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting asset'),
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter((a) =>
      [a.assetId, a.assetName, a.assetType, a.assetCategory, a.serialNumber, a.manufacturer, a.model]
        .some((v) => v?.toLowerCase().includes(term)),
    );
  }, [assets, q]);

  const askDelete = async (a: Asset) => {
    const ok = await confirm({
      title: 'Delete this asset?',
      description: `${a.assetId} — ${a.assetName} and its allocation history will be removed.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (ok) remove.mutate(a.id);
  };

  const Dash = () => <span className="text-muted-foreground">—</span>;

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Asset Master</h1>
          <p className="text-sm text-muted-foreground">
            Every asset is one physical unit, identified by its own asset ID.
          </p>
        </div>
        <Button onClick={() => navigate('/admin/assets/new')}>
          <Plus className="size-4" /> New asset
        </Button>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets…" className="pl-8" />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <HardDrive className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {q ? 'No assets match your search.' : 'No assets in the register yet.'}
          </p>
          {!q && (
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/assets/new')}>
              <Plus className="size-4" /> Add the first asset
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="border-r"><HeadLabel icon={Barcode}>Asset ID</HeadLabel></TableHead>
                <TableHead className="w-full border-r"><HeadLabel icon={Package}>Asset name</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Tag}>Type</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Layers}>Category</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={Hash}>Serial number</HeadLabel></TableHead>
                <TableHead className="border-r"><HeadLabel icon={UserRound}>Allocated to</HeadLabel></TableHead>
                <TableHead className="w-px text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/admin/assets/${a.id}/edit`)}
                >
                  <TableCell className="w-px border-r">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.assetId}</code>
                  </TableCell>
                  <TableCell className="w-full border-r font-medium text-foreground">
                    <span className="block max-w-[18rem] truncate" title={a.assetName}>{a.assetName}</span>
                  </TableCell>
                  <TableCell className="border-r">
                    {a.assetType
                      ? <span className="block max-w-[10rem] truncate" title={a.assetType}>{a.assetType}</span>
                      : <Dash />}
                  </TableCell>
                  <TableCell className="border-r">
                    {a.assetCategory
                      ? <span className="block max-w-[10rem] truncate" title={a.assetCategory}>{a.assetCategory}</span>
                      : <Dash />}
                  </TableCell>
                  <TableCell className="border-r whitespace-nowrap">{a.serialNumber || <Dash />}</TableCell>
                  <TableCell className="border-r whitespace-nowrap">
                    {a.allocation ? (
                      <span className="flex items-center gap-2">
                        <span className="block max-w-[12rem] truncate" title={a.allocation.employeeName ?? undefined}>
                          {a.allocation.employeeName ?? '—'}
                        </span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold uppercase ${allocationStatusPill(a.allocation.status)}`}>
                          {allocationStatusLabel(a.allocation.status)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Available</span>
                    )}
                  </TableCell>
                  <TableCell className="w-px text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="icon" className="size-8"
                        title={`Edit ${a.assetId}`}
                        onClick={(e) => { e.stopPropagation(); navigate(`/admin/assets/${a.id}/edit`); }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        title={`Delete ${a.assetId}`}
                        onClick={(e) => { e.stopPropagation(); askDelete(a); }}
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

      {ConfirmDialog}
    </div>
  );
}

function HeadLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}
