import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Upload, Pencil, Trash2, Star, MessageSquareText, ChevronLeft, ChevronRight, X, ImageOff, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { useAuth } from '../../context/AuthContext';
import { useDateFormat } from '../../lib/dateFormat';
import { useConfirm, usePrompt } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import AlbumFormDialog from './AlbumFormDialog';
import {
  CATEGORY_LABEL, categoryPill, MAX_PHOTOS_PER_UPLOAD, MAX_UPLOAD_MB, type Album, type GalleryPhoto,
} from './galleryMeta';

type UploadResult = { added: { id: string; name: string }[]; errors: { name: string; message: string }[] };

/** One album: its photos, a full-screen viewer, and (for Admins) upload and editing. */
export default function AlbumPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Arrived from a suggested announcement ("Add photos & announce"): Announce carries it on.
  const [params] = useSearchParams();
  const suggestionId = params.get('suggestion');
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const { fmtDate } = useDateFormat();
  const { confirm, ConfirmDialog } = useConfirm();
  const { prompt, PromptDialog } = usePrompt();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  const { data: album, isLoading, isError } = useQuery<Album>({
    queryKey: ['gallery-album', id],
    queryFn: async () => (await api.get(`/api/gallery/albums/${id}`)).data,
  });
  const photos = album?.photos ?? [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['gallery-album', id] });
    qc.invalidateQueries({ queryKey: ['gallery-albums'] });
  };

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('photos', f));
      return (await api.post(`/api/gallery/albums/${id}/photos`, fd)).data as UploadResult;
    },
    onSuccess: (r) => {
      refresh();
      if (r.added.length) toast.success(`${r.added.length} photo${r.added.length === 1 ? '' : 's'} added`);
      // Each refused file is named, so the admin knows which ones to fix.
      r.errors.forEach((e) => toast.error(`${e.name}: ${e.message}`, { duration: 8000 }));
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Upload failed'),
  });

  const patchPhoto = useMutation({
    mutationFn: (v: { photoId: string; caption?: string | null; cover?: boolean }) =>
      api.patch(`/api/gallery/photos/${v.photoId}`, { caption: v.caption, cover: v.cover }),
    onSuccess: (_r, v) => { refresh(); if (v.cover) toast.success('Cover photo set'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const deletePhoto = useMutation({
    mutationFn: (photoId: string) => api.delete(`/api/gallery/photos/${photoId}`),
    onSuccess: () => { refresh(); toast.success('Photo deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });
  const deleteAlbum = useMutation({
    mutationFn: () => api.delete(`/api/gallery/albums/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gallery-albums'] }); toast.success('Album deleted'); navigate('/gallery'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // picking the same files again must still fire
    if (!files.length) return;
    if (files.length > MAX_PHOTOS_PER_UPLOAD) {
      toast.error(`Choose at most ${MAX_PHOTOS_PER_UPLOAD} photos at a time`);
      return;
    }
    const tooBig = files.filter((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    if (tooBig.length) {
      toast.error(`${tooBig.map((f) => f.name).join(', ')}: over ${MAX_UPLOAD_MB} MB — too large to upload`);
      return;
    }
    upload.mutate(files);
  };

  const editCaption = async (p: GalleryPhoto) => {
    const v = await prompt({ title: 'Photo caption', label: 'Caption', defaultValue: p.caption ?? '', placeholder: 'Who, where…', confirmText: 'Save' });
    if (v !== null) patchPhoto.mutate({ photoId: p.id, caption: v.trim() || null });
  };

  // Arrow keys and Escape in the viewer.
  useEffect(() => {
    if (viewing === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setViewing((i) => (i === null ? i : (i + 1) % photos.length));
      if (e.key === 'ArrowLeft') setViewing((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing, photos.length]);

  const back = (
    <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/gallery')}>
      <ArrowLeft className="size-4" /> Back to gallery
    </Button>
  );
  if (isLoading) return <div>{back}<p className="text-muted-foreground">Loading…</p></div>;
  if (isError || !album) return <div>{back}<p className="text-muted-foreground">This album isn't available.</p></div>;

  const current = viewing !== null ? photos[viewing] : null;
  const coverId = album.coverPhotoId ?? photos[0]?.id;

  return (
    <div>
      {ConfirmDialog}
      {PromptDialog}
      {back}

      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <span className={`mb-2 inline-block rounded px-1.5 py-0.5 text-xs font-bold uppercase ${categoryPill(album.category)}`}>
            {CATEGORY_LABEL[album.category] ?? album.category}
          </span>
          <h1 className="text-2xl font-bold text-foreground">{album.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[album.eventDate ? fmtDate(album.eventDate) : null,
              album.project ? `Project: ${album.project.name}` : null,
              album.customerCompany ? `Client: ${album.customerCompany.name}` : null,
              `${photos.length} photo${photos.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          </p>
          {album.description && <p className="mt-3 max-w-3xl text-sm whitespace-pre-line text-foreground">{album.description}</p>}
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickFiles} />
            <Button disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> {upload.isPending ? 'Uploading…' : 'Add photos'}
            </Button>
            {/* Opens a new announcement already filled in from this album — reviewed before it goes out. */}
            <Button
              variant="outline"
              onClick={() => {
                if (!photos.length) { toast.error('Add some photos first — the announcement shows them'); return; }
                navigate(`/communications/new?albumId=${album.id}${suggestionId ? `&suggestion=${suggestionId}` : ''}`);
              }}
            >
              <Megaphone className="size-4" /> Announce
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
            <Button
              variant="outline" className="text-destructive hover:text-destructive"
              onClick={async () => {
                if (await confirm({ title: `Delete "${album.title}"?`, description: `Its ${photos.length} photo(s) are deleted with it.`, destructive: true, confirmText: 'Delete album' })) deleteAlbum.mutate();
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {isAdmin && suggestionId && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <Megaphone className="size-4 shrink-0" />
          From a suggested announcement — add the photos, then click <strong>Announce</strong> to write it.
        </div>
      )}
      {isAdmin && (
        <p className="mb-3 text-xs text-muted-foreground">
          Up to {MAX_PHOTOS_PER_UPLOAD} photos at a time (JPEG, PNG or WebP). Large photos are shrunk automatically — each is stored at 1 MB or less.
        </p>
      )}

      {photos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-muted-foreground">
          <ImageOff className="size-8" />
          <p className="text-sm">No photos yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <figure key={p.id} className="group relative overflow-hidden rounded-lg border bg-muted">
              <button type="button" className="block aspect-square w-full" onClick={() => setViewing(i)}>
                <img src={assetUrl(p.thumbUrl) ?? undefined} alt={p.caption ?? ''} loading="lazy" className="size-full object-cover" />
              </button>
              {p.id === coverId && (
                <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">Cover</span>
              )}
              {p.caption && <figcaption className="truncate px-2 py-1.5 text-xs text-foreground" title={p.caption}>{p.caption}</figcaption>}
              {isAdmin && (
                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button size="icon" variant="secondary" className="size-7" title="Make cover" onClick={() => patchPhoto.mutate({ photoId: p.id, cover: true })}>
                    <Star className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="secondary" className="size-7" title="Caption" onClick={() => editCaption(p)}>
                    <MessageSquareText className="size-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="secondary" className="size-7 text-destructive" title="Delete photo"
                    onClick={async () => { if (await confirm({ title: 'Delete this photo?', destructive: true, confirmText: 'Delete' })) deletePhoto.mutate(p.id); }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </figure>
          ))}
        </div>
      )}

      {/* Full-screen viewer */}
      <Dialog open={current !== null} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent showCloseButton={false} className="max-w-5xl gap-0 overflow-hidden border-0 bg-black p-0 sm:max-w-5xl">
          <DialogTitle className="sr-only">{current?.caption || album.title}</DialogTitle>
          {current && (
            <div className="relative">
              <img src={assetUrl(current.fileUrl) ?? undefined} alt={current.caption ?? ''} className="mx-auto max-h-[80svh] w-auto object-contain" />
              <button type="button" onClick={() => setViewing(null)} className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white" aria-label="Close">
                <X className="size-5" />
              </button>
              {photos.length > 1 && (
                <>
                  <button type="button" aria-label="Previous" onClick={() => setViewing((i) => (i! - 1 + photos.length) % photos.length)}
                    className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white"><ChevronLeft className="size-5" /></button>
                  <button type="button" aria-label="Next" onClick={() => setViewing((i) => (i! + 1) % photos.length)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white"><ChevronRight className="size-5" /></button>
                </>
              )}
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-white/90">
                <span className="truncate">{current.caption || ' '}</span>
                <span className="shrink-0 text-xs text-white/60">{(viewing ?? 0) + 1} / {photos.length}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlbumFormDialog open={editing} album={album} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
    </div>
  );
}
