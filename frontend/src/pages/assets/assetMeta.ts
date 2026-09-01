import {
  Laptop, Monitor, MonitorSmartphone, Smartphone, Tablet, Headphones, Server, Printer,
  Projector, Router, Cable, CreditCard, Keyboard, HardDrive, Cpu, Package,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Mirrors `backend/src/assets/dto/asset.dto.ts`. Every descriptive field is free
 * text by design — the Asset Master form has no dropdowns, so nothing here is
 * backed by an option list.
 */
export interface Asset {
  id: string;
  assetId: string;
  assetName: string;
  description?: string | null;
  assetType?: string | null;
  assetCategory?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  barcode?: string | null;
  warrantyStart?: string | null;
  warrantyEnd?: string | null;
  purchaseDate?: string | null;
  poNumber?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  lifespan?: string | null;
  /** The unit's own condition, independent of who is holding it. */
  condition: string;
  /** The open allocation, when the asset is out with someone. */
  allocation?: {
    id: string;
    status: string;
    issuedDate?: string | null;
    retention: string;
    expectedReturnDate?: string | null;
    employeeUserId: string;
    employeeName?: string | null;
    employeeCode?: string | null;
  } | null;
}

/**
 * Where an asset stands right now: with someone, or on the shelf in whatever
 * condition it came back in.
 *
 * This is the asset's side of the story; `ALLOCATION_STATUSES` is the
 * allocation's. An asset has many allocations over its life but only ever one
 * open one, so the four states below partition the register exactly once —
 * being held wins over being damaged, since a unit in someone's hands is not
 * sitting in a repair queue whatever state it is in.
 */
export type AssetState = 'IN_USE' | 'IN_STORE' | 'IN_REPAIR' | 'OTHERS';

export const ASSET_STATES: { value: AssetState; label: string }[] = [
  { value: 'IN_USE', label: 'In use' },
  { value: 'IN_STORE', label: 'In store' },
  { value: 'IN_REPAIR', label: 'In repair' },
  { value: 'OTHERS', label: 'Others' },
];

export const assetState = (a: Asset): AssetState => {
  if (a.allocation) return 'IN_USE';           // someone is holding it
  if (a.condition === 'DAMAGED') return 'IN_REPAIR';
  if (a.condition === 'RETIRED') return 'OTHERS';
  return 'IN_STORE';                           // free and serviceable
};

export const assetStateLabel = (v?: string | null) =>
  ASSET_STATES.find((s) => s.value === v)?.label ?? v ?? '-';

/** Tone for a state, on the overview counts and the list pill. */
export const assetStatePill = (v?: string | null) =>
  v === 'IN_USE' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
  : v === 'IN_STORE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  : v === 'IN_REPAIR' ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'
  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';

/**
 * The icon for an asset type. Matched on the type name the admin actually chose,
 * lower-cased and substring-matched, so "Cisco Router" and "Router" land on the
 * same glyph and a type added on /admin/options gets a sensible icon without a
 * code change. `Package` is the fallback — an unmatched type still reads as a
 * thing you can hold.
 */
const ICON_RULES: [RegExp, LucideIcon][] = [
  [/laptop|notebook|macbook|chromebook/, Laptop],
  [/desktop|computer|workstation/, MonitorSmartphone],
  [/monitor|display|screen/, Monitor],
  [/phone|mobile|handset/, Smartphone],
  [/tablet|ipad/, Tablet],
  [/headset|headphone|earphone/, Headphones],
  [/server|rack|blade/, Server],
  [/printer|scanner|copier/, Printer],
  [/projector/, Projector],
  [/router|switch|firewall|access point|network|modem/, Router],
  [/dock|hub|cable/, Cable],
  [/card|badge|licen[cs]e/, CreditCard],
  [/keyboard|mouse|peripheral|webcam/, Keyboard],
  [/drive|storage|disk|nas/, HardDrive],
  [/cpu|processor|component|memory|ram/, Cpu],
];

export const assetTypeIcon = (type?: string | null): LucideIcon => {
  const t = (type ?? '').toLowerCase();
  return ICON_RULES.find(([re]) => re.test(t))?.[1] ?? Package;
};

/** One card on the Asset Master overview. */
export interface AssetTypeGroup {
  type: string;          // '' for assets with no type set
  label: string;
  total: number;
  counts: Record<AssetState, number>;
}

/**
 * Group the register by type for the overview. Every type in the option list
 * gets a card even when empty — an empty Laptop card is the honest answer to
 * "how many laptops do we have", and it is how an admin sees that a type they
 * just added on /admin/options is live.
 */
export function groupAssetsByType(assets: Asset[], listedTypes: string[]): AssetTypeGroup[] {
  const blank = (): Record<AssetState, number> =>
    ({ IN_USE: 0, IN_STORE: 0, IN_REPAIR: 0, OTHERS: 0 });
  const groups = new Map<string, AssetTypeGroup>();
  for (const t of listedTypes) groups.set(t, { type: t, label: t, total: 0, counts: blank() });

  for (const a of assets) {
    const key = a.assetType?.trim() || '';
    if (!groups.has(key)) {
      groups.set(key, { type: key, label: key || 'Unclassified', total: 0, counts: blank() });
    }
    const g = groups.get(key)!;
    g.total += 1;
    g.counts[assetState(a)] += 1;
  }

  // Types holding something first, then the empty ones — an admin looking for
  // real stock should not have to read past a run of zeroes.
  return [...groups.values()].sort((a, b) =>
    (b.total > 0 ? 1 : 0) - (a.total > 0 ? 1 : 0) || a.label.localeCompare(b.label));
}
