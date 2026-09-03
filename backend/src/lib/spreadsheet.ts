import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import * as XLSX from 'xlsx';

/**
 * The Excel import/export plumbing shared by the Employee and Asset masters.
 *
 * One column definition drives all three doors: the export sheet, the blank
 * import template, and the header matching on the way back in — so a column
 * added here can never appear in the download and then be silently ignored by
 * the importer. `xlsx` is already a backend dependency (the timesheet import
 * uses it); nothing new is pulled in.
 */
export interface SheetColumn<T = unknown> {
  /** The header written to the sheet, and the primary name matched on import. */
  header: string;
  /** Other spellings the importer accepts for this column (matched case-insensitively). */
  aliases?: string[];
  /** How the value is rendered on export. Omit for a column the export leaves blank. */
  value?: (row: T) => unknown;
  /** Column width in characters. */
  width?: number;
  /** What the Instructions sheet says about the column — required-ness, allowed values. */
  note?: string;
  /** Read-back-only: shown in the export for context, absent from the template. */
  exportOnly?: boolean;
}

/** How many data rows one upload may carry — a guard against a runaway paste. */
export const MAX_IMPORT_ROWS = 1000;

const widths = (columns: SheetColumn<any>[]) =>
  columns.map((c) => ({ wch: c.width ?? Math.max(12, c.header.length + 2) }));

/** A sheet of `rows` under `columns`, as a workbook buffer. */
export function exportSheet<T>(sheetName: string, columns: SheetColumn<T>[], rows: T[]): Buffer {
  const body = rows.map((row) =>
    columns.map((c) => {
      const v = c.value?.(row);
      return v === undefined || v === null ? '' : v;
    }),
  );
  const sheet = XLSX.utils.aoa_to_sheet([columns.map((c) => c.header), ...body]);
  sheet['!cols'] = widths(columns);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * The blank import template: the headers on one sheet, and an Instructions sheet
 * spelling out what each column wants. `exportOnly` columns are left out — they
 * are read-back context (an asset's state, who holds it), not something an
 * import can set, and offering an empty box for one only invites it to be filled.
 */
export function importTemplate<T>(
  sheetName: string,
  columns: SheetColumn<T>[],
  instructions: string[] = [],
): Buffer {
  const fields = columns.filter((c) => !c.exportOnly);
  const sheet = XLSX.utils.aoa_to_sheet([fields.map((c) => c.header)]);
  sheet['!cols'] = widths(fields);

  const guide = XLSX.utils.aoa_to_sheet([
    ['How to use this template'],
    ...instructions.map((line) => [line]),
    [],
    ['Column', 'Notes'],
    ...fields.map((c) => [c.header, c.note ?? '']),
  ]);
  guide['!cols'] = [{ wch: 24 }, { wch: 90 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  XLSX.utils.book_append_sheet(wb, guide, 'Instructions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Stream a generated workbook back as a download. */
export function sendWorkbook(res: Response, filename: string, buffer: Buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // The browser can only read a header it is allowed to see, and the app is on a
  // different origin from the API — without this the filename never arrives.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.end(buffer);
}

/** `YYYY-MM-DD` today, for a download's filename. */
export const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * The first sheet of an uploaded workbook, as one record per row. Multer is
 * configured for memory or disk depending on the route, so both are handled.
 */
export function readSheet(file?: Express.Multer.File): Record<string, unknown>[] {
  if (!file?.buffer && !file?.path) throw new BadRequestException('No file uploaded');
  const wb = file.buffer
    ? XLSX.read(file.buffer, { type: 'buffer', cellDates: true })
    : XLSX.readFile(file.path, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new BadRequestException('Spreadsheet has no sheets');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(`Too many rows — ${MAX_IMPORT_ROWS} at most per import`);
  }
  return rows;
}

/**
 * A reader over one parsed row that looks a column up by its header or any of
 * its aliases, ignoring case and surrounding space — a sheet edited by hand
 * rarely comes back with the headers byte-identical.
 */
export function rowReader(record: Record<string, unknown>) {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(record)) byKey.set(k.trim().toLowerCase(), v);

  return <T>(column: SheetColumn<T>): unknown => {
    for (const name of [column.header, ...(column.aliases ?? [])]) {
      const hit = byKey.get(name.trim().toLowerCase());
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
}

/** A cell as trimmed text — '' for a blank, so callers can tell blank from absent. */
export const asText = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/**
 * A cell as `YYYY-MM-DD`. Excel dates arrive as `Date` (the readers run with
 * `cellDates`), typed ones as text. An unparseable value is rejected rather than
 * quietly stored as the epoch.
 */
export function asDate(v: unknown, label: string): string | null {
  const text = asText(v);
  if (!text) return null;
  const date = v instanceof Date ? v : new Date(text);
  if (isNaN(date.getTime())) throw new BadRequestException(`${label}: "${text}" is not a date`);
  return date.toISOString().slice(0, 10);
}

/** `Date` | ISO -> the `YYYY-MM-DD` an export cell carries. */
export const dateCell = (v?: Date | string | null) =>
  v ? new Date(v).toISOString().slice(0, 10) : '';

/**
 * A cell matched against a fixed vocabulary, by stored value or by label, so a
 * sheet exported with "Damaged" in it imports back as `DAMAGED`.
 */
export function asEnum(
  v: unknown,
  values: readonly string[],
  labels: Record<string, string>,
  label: string,
): string | null {
  const text = asText(v);
  if (!text) return null;
  const want = text.toLowerCase();
  const hit = values.find((x) => x.toLowerCase() === want || labels[x]?.toLowerCase() === want);
  if (!hit) throw new BadRequestException(`${label}: "${text}" is not one of ${values.join(', ')}`);
  return hit;
}

/** What every import returns — a per-row account, so nothing fails silently. */
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

/** The message an unknown thrown value carries, for an import's error list. */
export const errorText = (e: unknown) =>
  (e as { response?: { message?: string } })?.response?.message ||
  (e as { message?: string })?.message ||
  'Could not save this row';
