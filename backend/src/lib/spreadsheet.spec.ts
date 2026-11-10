import * as XLSX from 'xlsx';
import { exportSheet, importTemplate, readSheet, rowReader, asDate, asText, SheetColumn } from './spreadsheet';

/**
 * The importers parse workbooks users upload, so the parser version is a
 * security boundary: SheetJS before 0.19.3 is open to prototype pollution from a
 * crafted file (CVE-2023-30533) and before 0.20.2 to ReDoS (CVE-2024-22363).
 * npm's `xlsx` stopped at 0.18.5, so the fixed build is vendored from cdn.sheetjs.com.
 */
const asFile = (buffer: Buffer) => ({ buffer }) as Express.Multer.File;

describe('spreadsheet', () => {
  it('runs a SheetJS build with the parser CVEs fixed', () => {
    const [major, minor, patch] = XLSX.version.split('.').map(Number);
    expect(major * 10000 + minor * 100 + patch).toBeGreaterThanOrEqual(2002);
  });

  type Row = { name: string; joined: Date; hours: number };
  const columns: SheetColumn<Row>[] = [
    { header: 'Name', aliases: ['Employee'], value: (r) => r.name },
    { header: 'Joined', value: (r) => r.joined },
    { header: 'Hours', value: (r) => r.hours },
    { header: 'Holder', value: () => null, exportOnly: true },
  ];

  it('reads back what it exports: text, numbers and dates', () => {
    const buf = exportSheet('Staff', columns, [
      { name: 'Anbu', joined: new Date(Date.UTC(2025, 6, 13)), hours: 7.5 },
    ]);
    const rows = readSheet(asFile(buf));
    expect(rows).toHaveLength(1);
    const read = rowReader(rows[0]);
    expect(read(columns[0])).toBe('Anbu');
    expect(read(columns[2])).toBe(7.5);
    expect(asDate(read(columns[1]), 'Joined')).toBe('2025-07-13');
    expect(asText(read(columns[3]))).toBe('');
  });

  it('matches headers by alias regardless of case and spacing', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['  employee '], ['Kavi']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'S');
    const rows = readSheet(asFile(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
    expect(rowReader(rows[0])(columns[0])).toBe('Kavi');
  });

  it('leaves export-only columns out of the template and adds the Instructions sheet', () => {
    const wb = XLSX.read(importTemplate('Staff', columns, ['Fill one row per person']), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Staff', 'Instructions']);
    const header = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Staff, { header: 1 })[0];
    expect(header).toEqual(['Name', 'Joined', 'Hours']);
  });

  it('does not let a crafted sheet pollute Object.prototype', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['__proto__', 'constructor'], ['{"polluted":1}', 'x']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'S');
    readSheet(asFile(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
