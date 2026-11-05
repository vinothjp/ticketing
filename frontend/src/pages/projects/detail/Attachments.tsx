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

interface Attachment {
  id: string;
  fileName?: string | null;
  filePath?: string | null;
  url?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

// Reusable attachments panel (file upload OR pasted link) for any project sub-entity.
export default function Attachments({
  projectId, entityType, entityId, canEdit = true, compact = false, acceptTypes,
}: {
  projectId: string;
  entityType: string;
  entityId: string;
  canEdit?: boolean;
  compact?: boolean;
  acceptTypes?: string[];
}) {
  const qc = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const key = ['projects', projectId, 'attachments', entityType, entityId];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const { data: items = [] } = useQuery<Attachment[]>({
    queryKey: key,
    queryFn: async () => (await api.get(`/api/projects/${projectId}/attachments`, { params: { entityType, entityId } })).data,
  });

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const fd = new FormData();
      fd.append('entityType', entityType);
      fd.append('entityId', entityId);
      files.forEach((f) => fd.append('attachments', f));
      return api.post(`/api/projects/${projectId}/attachments/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => { invalidate(); toast.success('File uploaded'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Upload failed'),
  });
  const addLink = useMutation({
    mutationFn: () => api.post(`/api/projects/${projectId}/attachments/link`, { entityType, entityId, url: link.trim() }),
    onSuccess: () => { invalidate(); setLink(''); toast.success('Link added'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding link'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/attachments/${id}`),
    onSuccess: () => { invalidate(); toast.success('Removed'); },
  });

  const href = (a: Attachment) => a.url || assetUrl(a.filePath) || '#';

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {ConfirmDialog}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              {a.url ? <Link2 className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
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
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept={acceptAttr(acceptTypes)}
            onChange={(e) => {
              const picked = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              const { ok, tooBig, badType } = splitAllowed(picked, acceptTypes);
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
      {canEdit && <p className="text-xs text-muted-foreground">{uploadHint(acceptTypes)}</p>}

      {!canEdit && items.length === 0 && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><Paperclip className="size-3" /> No attachments</p>
      )}
    </div>
  );
}
