import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Circle, History, PackagePlus, PackageCheck, PackageX, Pencil, ShieldAlert,
  UserRoundCheck, RotateCcw, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { useDateFormat } from '@/lib/dateFormat';

interface AssetActivity {
  id: string;
  assetId: string;
  allocationId?: string | null;
  employeeUserId?: string | null;
  employeeName?: string | null;
  type: string;
  summary: string;
  actorName?: string | null;
  createdAt: string;
  assetCode?: string | null;
  assetName?: string | null;
}

/**
 * The icon per event type, in the same mould as `HistoryTab`'s map — a type with
 * no entry falls back to a plain circle rather than breaking the row.
 */
const ICON: Record<string, LucideIcon> = {
  ASSET_CREATED: PackagePlus,
  ASSET_UPDATED: Pencil,
  CONDITION_CHANGED: ShieldAlert,
  ALLOCATED: UserRoundCheck,
  RETURNED: PackageCheck,
  REISSUED: RotateCcw,
  REASSIGNED: UserRoundCheck,
  ALLOCATION_UPDATED: Pencil,
  ALLOCATION_REMOVED: PackageX,
};

const PREVIEW = 8;

/**
 * The audit trail of an asset, or of what one employee has held. Both read the
 * same `api/asset-activity` rows — the trail is keyed on the asset and carries
 * the employee, so neither screen needs a store of its own.
 *
 * Deleting an allocation is itself an entry here, which is why
 * `AssetActivity.allocationId` is deliberately not a foreign key: the history has
 * to outlive the row it describes.
 */
export default function AssetActivityTimeline({
  assetId, employeeUserId,
}: {
  assetId?: string;
  employeeUserId?: string;
}) {
  // A history is a record of *when*, so the stamp is always absolute — and in
  // the format this organization chose, not the one the browser happens to use.
  const { fmtDateTime } = useDateFormat();
  const [expanded, setExpanded] = useState(false);

  const scope = assetId ?? employeeUserId ?? '';
  const { data: items = [] } = useQuery<AssetActivity[]>({
    queryKey: ['asset-activity', assetId ? 'asset' : 'employee', scope],
    queryFn: async () =>
      (await api.get('/api/asset-activity', {
        params: assetId ? { assetId } : { employeeUserId },
      })).data,
    enabled: !!scope,
  });

  const shown = expanded ? items : items.slice(0, PREVIEW);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          <History className="size-4" /> History
        </h2>
        <p className="text-sm text-muted-foreground">
          {assetId
            ? 'Every allocation and change this unit has been through.'
            : 'Every asset this employee has been issued, returned or handed on.'}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          Nothing recorded yet.
        </p>
      ) : (
        <>
          <ol className="space-y-4">
            {shown.map((a) => {
              const Icon = ICON[a.type] ?? Circle;
              return (
                <li key={a.id} className="flex gap-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-foreground">
                      {/* On the employee view the summary names the person, so
                          the unit has to lead — otherwise three issues to the
                          same person read identically. */}
                      {!assetId && a.assetCode && (
                        <code
                          className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-xs"
                          title={a.assetName ?? undefined}
                        >
                          {a.assetCode}
                        </code>
                      )}
                      {a.summary}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.actorName ?? 'System'} · {fmtDateTime(a.createdAt)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {items.length > PREVIEW && (
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setExpanded((e) => !e)}>
              {expanded ? (
                <><ChevronUp className="size-4" /> Show less</>
              ) : (
                <><ChevronDown className="size-4" /> Show all {items.length} entries</>
              )}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
