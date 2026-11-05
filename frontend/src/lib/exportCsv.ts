// Tiny client-side CSV export: turn an array of rows into a downloaded .csv file.
// `columns` maps a header label to a value accessor for each row.

type Column<T> = { header: string; value: (row: T) => unknown };

const escape = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Quote if the value contains a comma, quote, or newline; double up inner quotes.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv<T>(filename: string, rows: T[], columns: Column<T>[]): void {
  const header = columns.map((c) => escape(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escape(c.value(r))).join(',')).join('\n');
  const csv = `${header}\n${body}`;
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }); // BOM → Excel opens UTF-8 cleanly
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
