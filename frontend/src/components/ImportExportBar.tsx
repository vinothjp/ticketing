import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Upload, FileSpreadsheet, CircleAlert, CircleCheck } from 'lucide-react';
import api from '../lib/api';
import { downloadFile, blobErrorMessage } from '../lib/download';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** The per-row account every import answers with. Mirrors `lib/spreadsheet.ts`. */
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

/**
 * Download template · Import · Export, for a screen backed by a spreadsheet.
 *
 * One component serves both masters so the three doors behave identically: the
 * template is the export's own columns, an import answers with a per-row account
 * rather than a bare toast, and a row the server refused names its sheet line so
 * the admin can go and fix it. The three endpoints are the only difference
 * between the two screens.
 */
export default function ImportExportBar({
  exportUrl, templateUrl, importUrl, noun, templateName, onImported,
}: {
  exportUrl: string;
  templateUrl: string;
  importUrl: string;
  /** What is being imported, for the messages — 'employees', 'assets'. */
  noun: string;
  /** The template's filename, used if the response does not name one. */
  templateName: string;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const download = useMutation({
    mutationFn: ({ url, name }: { url: string; name: string }) => downloadFile(url, name),
    onError: async (e) => toast.error(await blobErrorMessage(e, 'Download failed')),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return (await api.post(importUrl, fd)).data as ImportResult;
    },
    onSuccess: (res) => {
      // The dialog is the report; the toast is only the headline, so a clean
      // import needs no click to dismiss and a partial one says where to look.
      const done = res.created + res.updated;
      if (res.errors.length) {
        setResult(res);
        toast.warning(`${done} row(s) saved, ${res.skipped} skipped`);
      } else {
        toast.success(`${res.created} added, ${res.updated} updated`);
      }
      onImported();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Import failed'),
  });

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    // Cleared so picking the same file twice still fires a change event —
    // re-importing a sheet you have just corrected is the normal case.
    e.target.value = '';
  };

  const busy = download.isPending || upload.isPending;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={pickFile}
      />

      <Button
        variant="outline"
        disabled={busy}
        onClick={() => download.mutate({ url: templateUrl, name: templateName })}
        title={`A blank sheet with the columns an import of ${noun} accepts`}
      >
        <FileSpreadsheet className="size-4" /> Download template
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Upload className="size-4" /> {upload.isPending ? 'Importing…' : 'Import'}
      </Button>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => download.mutate({ url: exportUrl, name: `${noun}.xlsx` })}
      >
        <Download className="size-4" /> Export
      </Button>

      <Dialog open={!!result} onOpenChange={(open) => { if (!open) setResult(null); }}>
        <DialogContent className="flex max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import finished</DialogTitle>
            <DialogDescription>
              Everything the sheet could save has been saved. The rows below were left untouched —
              correct them in the sheet and import it again.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CircleCheck className="size-3.5" /> {result?.created ?? 0} added
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
              <CircleCheck className="size-3.5" /> {result?.updated ?? 0} updated
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">
              <CircleAlert className="size-3.5" /> {result?.skipped ?? 0} skipped
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-px border-r text-xs font-semibold text-muted-foreground">
                    Sheet row
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground">
                    Why it was skipped
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result?.errors.map((err) => (
                  <TableRow key={`${err.row}-${err.message}`}>
                    <TableCell className="w-px border-r tabular-nums">{err.row}</TableCell>
                    <TableCell>{err.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button onClick={() => setResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
