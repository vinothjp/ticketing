import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Upload, Link2, Trash2, FileText, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { assetUrl } from '../../../lib/assetUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/hooks/useConfirm';
import { acceptAttr, uploadHint, MAX_UPLOAD_MB, splitAllowed } from '../../../lib/uploads';
import { OptionSelect } from '../OptionSelect';

interface CrAttachment {
  id: string;
  entityType: string;
  title?: string | null;
  fileName?: string | null;
  filePath?: string | null;
  url?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

// Self-contained attachments panel (file upload OR pasted link) for a Change
// Request slot (blueprint | supportive | uat). Points only at the CR API — it
// shares nothing with the project-management attachment endpoints.
export default function CrAttachments({
  crId, entityType, withTitle = false, titleListKey, canEdit = true,
}: {
  crId: string;
  entityType: string;
  withTitle?: boolean;      // supportive documents label each file with a title
  titleListKey?: string;    // when set, the title is chosen from this CR option list
  canEdit?: boolean;
}) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const key = ['cr-attachments', crId, entityType];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const { data: items = [] } = useQuery<CrAttachment[]>({
    queryKey: key,
    queryFn: async () => (await api.get(`/api/change-requests/${crId}/attachments`, { params: { entityType } })).data,
  });

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const fd = new FormData();
      fd.append('entityType', entityType);
      if (withTitle && title.trim()) fd.append('title', title.trim());
      files.forEach((f) => fd.append('attachments', f));
      return api.post(`/api/change-requests/${crId}/attachments/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => { invalidate(); setTitle(''); toast.success('File uploaded'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Upload failed'),
  });
  const addLink = useMutation({
    mutationFn: () => api.post(`/api/change-requests/${crId}/attachments/link`, {
      entityType, url: link.trim(), title: withTitle ? title.trim() || undefined : undefined,
    }),
    onSuccess: () => { invalidate(); setLink(''); setTitle(''); toast.success('Link added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding link'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/change-requests/attachments/${id}`),
    onSuccess: () => { invalidate(); toast.success('Removed'); },
  });

  const href = (a: CrAttachment) => a.url || assetUrl(a.filePath) || '#';

  return (
    <div className="space-y-3">
      {ConfirmDialog}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              {a.url ? <Link2 className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
              {withTitle && a.title && <span className="shrink-0 font-medium">{a.title}:</span>}
              <a href={href(a)} target="_blank" rel="noreferrer" className="flex-1 truncate hover:underline">{a.fileName || a.url}</a>
              <a href={href(a)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="size-3.5" /></a>
              {canEdit && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => { if (await confirm({ title: 'Remove attachment?', destructive: true, confirmText: 'Remove' })) del.mutate(a.id); }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {withTitle && (
            titleListKey
              ? <div className="w-48"><OptionSelect listKey={titleListKey} value={title} onChange={setTitle} placeholder="Document title…" /></div>
              : <Input className="h-8 w-48" placeholder="Document title…" value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept={acceptAttr()}
            onChange={(e) => {
              const picked = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              const { ok, tooBig, badType } = splitAllowed(picked);
              if (badType.length) toast.error(`${badType.length === 1 ? 'File type is' : 'Some file types are'} not allowed here`);
              if (tooBig.length) toast.error(`${tooBig.length === 1 ? 'File is' : 'Some files are'} over ${MAX_UPLOAD_MB} MB and were skipped`);
              if (ok.length) upload.mutate(ok);
            }}
          />
          <Button type="button" size="sm" variant="outline" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
            <Upload className="size-3.5" /> Upload
          </Button>
          <div className="flex items-center gap-1">
            <Input
              className="h-8 w-48"
              placeholder="Paste a link…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && link.trim()) addLink.mutate(); }}
            />
            <Button type="button" size="sm" variant="outline" disabled={!link.trim() || addLink.isPending} onClick={() => addLink.mutate()}>
              <Link2 className="size-3.5" /> Add
            </Button>
          </div>
        </div>
      )}
      {canEdit && <p className="text-xs text-muted-foreground">{uploadHint()}</p>}

      {!canEdit && items.length === 0 && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><Paperclip className="size-3" /> No attachments</p>
      )}
    </div>
  );
}
