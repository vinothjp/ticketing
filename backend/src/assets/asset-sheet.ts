import { SheetColumn, dateCell } from '../lib/spreadsheet';
import { ASSET_CONDITIONS, ASSET_CONDITION_LABELS, assetConditionLabel } from './allocation-status';

/**
 * One asset as the export writes it — the register row `AssetsService.list`
 * returns, whose `allocation` is the open holding if there is one.
 */
export interface AssetSheetRow {
  assetId: string;
  assetName: string;
  assetType?: string | null;
  assetCategory?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  barcode?: string | null;
  description?: string | null;
  poNumber?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  lifespan?: string | null;
  condition: string;
  purchaseDate?: Date | string | null;
  warrantyStart?: Date | string | null;
  warrantyEnd?: Date | string | null;
  allocation?: {
    employeeName?: string | null;
    employeeCode?: string | null;
    issuedDate?: Date | string | null;
  } | null;
}

const text = (key: keyof AssetSheetRow) => (r: AssetSheetRow) => (r[key] as string | null) ?? '';

/**
 * The Asset Master's columns. This one list drives the export, the template and
 * the header matching on import — the three can't drift apart.
 *
 * `Asset ID` is the match key: a row whose code is already in the register
 * updates that unit, anything else is added. Who is holding a unit is deliberately
 * `exportOnly` — an allocation is issued and returned on the allocation grid,
 * where the availability rule is enforced, not by typing a name into a spreadsheet.
 */
export const ASSET_COLUMNS: SheetColumn<AssetSheetRow>[] = [
  { header: 'Asset ID', aliases: ['asset code', 'code'], value: text('assetId'), width: 16,
    note: 'Required. The unit\'s own code, unique across the register. An existing code updates that asset; a new one adds it.' },
  { header: 'Asset name', aliases: ['name'], value: text('assetName'), width: 28,
    note: 'Required when adding. Left blank on an existing asset, the stored name is kept.' },
  { header: 'Type', aliases: ['asset type'], value: text('assetType'), width: 18,
    note: 'Free text. Values on the Asset Type option list are offered in the filters.' },
  { header: 'Category', aliases: ['asset category'], value: text('assetCategory'), width: 18, note: 'Free text.' },
  { header: 'Serial number', aliases: ['serial', 'serial no'], value: text('serialNumber'), width: 20, note: 'Free text.' },
  { header: 'Manufacturer', aliases: ['make', 'brand'], value: text('manufacturer'), width: 18, note: 'Free text.' },
  { header: 'Model', value: text('model'), width: 18, note: 'Free text.' },
  { header: 'Barcode', value: text('barcode'), width: 16, note: 'Free text.' },
  { header: 'Description', value: text('description'), width: 36, note: 'Free text.' },
  { header: 'PO number', aliases: ['po', 'purchase order'], value: text('poNumber'), width: 16, note: 'Free text.' },
  { header: 'Supplier', aliases: ['supplier name', 'vendor'], value: text('supplierName'), width: 20, note: 'Free text.' },
  { header: 'Invoice number', aliases: ['invoice', 'invoice no'], value: text('invoiceNumber'), width: 18, note: 'Free text.' },
  { header: 'Lifespan', value: text('lifespan'), width: 14, note: 'Free text, e.g. "3 years".' },
  {
    header: 'Condition',
    value: (r) => assetConditionLabel(r.condition),
    width: 14,
    note: `One of ${ASSET_CONDITIONS.map((c) => ASSET_CONDITION_LABELS[c]).join(' / ')}. Blank keeps the stored condition (OK on a new asset). Damaged is what puts a unit in the In repair state.`,
  },
  { header: 'Purchase date', value: (r) => dateCell(r.purchaseDate), width: 14, note: 'Date, e.g. 2026-04-15. Blank leaves it unset.' },
  { header: 'Warranty start', value: (r) => dateCell(r.warrantyStart), width: 14, note: 'Date, e.g. 2026-04-15.' },
  { header: 'Warranty end', value: (r) => dateCell(r.warrantyEnd), width: 14, note: 'Date, e.g. 2029-04-14.' },

  // Read-back context. Allocation is owned by the allocation grid, which is where
  // the one-open-allocation-per-asset rule lives.
  { header: 'Allocated to', value: (r) => r.allocation?.employeeName ?? '', width: 22, exportOnly: true },
  { header: 'Holder employee ID', value: (r) => r.allocation?.employeeCode ?? '', width: 18, exportOnly: true },
  { header: 'Issued on', value: (r) => dateCell(r.allocation?.issuedDate), width: 14, exportOnly: true },
];

export const ASSET_IMPORT_NOTES = [
  'Fill one row per physical unit. The first row must stay as the headers.',
  'Asset ID is the match key: a code already in the register updates that asset, a new code adds one.',
  'On an update, a blank cell leaves the stored value alone — clear a field on the asset screen instead.',
  'Allocating an asset to someone is done on the employee or asset screen, not here.',
];
