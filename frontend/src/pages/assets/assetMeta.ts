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
  /** The open allocation, when the asset is out with someone. */
  allocation?: {
    id: string;
    status: string;
    issuedDate?: string | null;
    employeeUserId: string;
    employeeName?: string | null;
    employeeCode?: string | null;
  } | null;
}

/** A row of the read-only "Allocated to" table on the asset screen. */
export interface AssetHolder {
  id: string;
  status: string;
  issuedDate?: string | null;
  returnDate?: string | null;
  employeeUserId: string;
  employeeCode?: string | null;
  employeeName?: string | null;
  department?: string | null;
  designation?: string | null;
}
