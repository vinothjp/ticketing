import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Paperclip, FileText, X, ExternalLink } from 'lucide-react';
import api from '../lib/api';
import { assetUrl } from '../lib/assetUrl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/** How long after the last keystroke the PO number is written. */
const SAVE_DELAY = 600;

/**
 * The purchase order a support contract was raised against: its number, and the
 * PO invoice filed beside it.
 *
 * **Both save on their own**, and neither waits for the Save button the terms
 * beside them use — type a number, attach the invoice, navigate away, and both
 * are still there. A PO is paperwork attached to a contract rather than a term
 * of it, and the file could never have ridden the terms payload anyway
 * (`main.ts` leaves Express's ~100 KB JSON cap in place, so a file needs its own
 * multipart route). Having the number save the same way is what keeps the pair
 * behaving as one thing instead of two halves with different rules.
 *
 * Which record they hang off follows the contract scope, and the caller supplies
 * that as `baseUrl`: the company for one shared customer contract, the purchase
 * for a per-product one. One component either way, so the two scopes cannot
 * drift apart.
 */
export default function PurchaseOrderFields({
  baseUrl, poNumber, fileUrl, fileName, readOnly = false, invalidate,
}: {
  /** The record's API path; `/po` and `/po-invoice` hang off it. */
  baseUrl: string;
  poNumber?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  readOnly?: boolean;
  /** Query keys to refetch once the PO changes. */
  invalidate: string[][];
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(poNumber ?? '');
  /** The last value known to be on the server — the baseline for "changed". */
  const saved = useRef(poNumber ?? '');

  const refresh = () => invalidate.forEach((queryKey) => qc.invalidateQueries({ queryKey }));

  // Re-hydrate only on a genuine server-side change. TanStack refetches on window
  // focus, and accepting every incoming prop would overwrite whatever is being
  // typed each time the admin tabs away and back.
  useEffect(() => {
    const incoming = poNumber ?? '';
    if (incoming !== saved.current) {
      saved.current = incoming;
      setValue(incoming);
    }
  }, [poNumber]);

  const saveNumber = useMutation({
    mutationFn: (next: string) => api.patch(`${baseUrl}/po`, { poNumber: next || null }),
    onSuccess: (_res, next) => { saved.current = next; refresh(); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not save the purchase order'),
  });

  // Written a beat after typing stops, so navigating away does not lose it. The
  // blur below writes it at once when the admin simply clicks elsewhere.
  useEffect(() => {
    if (readOnly) return;
    const next = value.trim();
    if (next === saved.current) return;
    const t = setTimeout(() => saveNumber.mutate(next), SAVE_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, readOnly]);

  const flush = () => {
    const next = value.trim();
    if (!readOnly && next !== saved.current) saveNumber.mutate(next);
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('invoice', file);
      return api.post(`${baseUrl}/po-invoice`, fd);
    },
    onSuccess: () => { refresh(); toast.success('PO invoice attached'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not attach the invoice'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`${baseUrl}/po-invoice`),
    onSuccess: () => { refresh(); toast.success('PO invoice removed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not remove the invoice'),
  });

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    // Cleared so re-picking the same file still fires a change event.
    e.target.value = '';
  };

  const href = assetUrl(fileUrl);
  const busy = upload.isPending || remove.isPending;

  // Both columns are label-over-control at the same heights (`h-8`, matching the
  // Input the terms above use), so the two read as one row rather than as two
  // controls that happen to sit side by side.
  return (
    <div className="grid grid-cols-2 items-start gap-2">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Purchase order</label>
        <Input
          className="h-8"
          value={value}
          disabled={readOnly}
          placeholder="PO-2026-0042"
          onChange={(e) => setValue(e.target.value)}
          onBlur={flush}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">PO invoice</label>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={pick}
        />

        {href ? (
          <div className="flex h-8 items-center gap-1.5 rounded-md border bg-muted/20 px-2">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            {/* Opens in a new tab rather than downloading — the point of keeping
                it here is that someone can look at it whenever they want. */}
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
              title={fileName || 'Open the PO invoice'}
            >
              {fileName || 'PO invoice'}
            </a>
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
            {!readOnly && (
              <Button
                type="button" size="icon" variant="ghost" className="size-5 shrink-0"
                disabled={busy}
                title="Remove this invoice"
                onClick={() => remove.mutate()}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        ) : readOnly ? (
          <p className="flex h-8 items-center rounded-md border border-dashed px-2 text-sm text-muted-foreground">
            None attached
          </p>
        ) : (
          <Button
            type="button" variant="outline"
            className="h-8 w-full justify-start px-2 text-sm font-normal text-muted-foreground"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="size-3.5" />
            {upload.isPending ? 'Attaching…' : 'Attach invoice'}
          </Button>
        )}
      </div>
    </div>
  );
}
