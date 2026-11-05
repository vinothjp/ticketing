import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Megaphone, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useDateFormat } from '../../lib/dateFormat';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CATEGORY_LABEL, categoryPill } from '../gallery/galleryMeta';
import type { Suggestion } from './communicationsMeta';

/**
 * "Suggested announcements" — prompts raised when a project is created, a
 * milestone is signed off or a project is completed. Admin only. Each is turned
 * into an announcement (with or without photos) or dismissed; nothing is sent
 * from here. A toolbar button (with the pending count) opens the list.
 */
export default function SuggestedAnnouncements() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { fmtDate } = useDateFormat();

  const { data: suggestions = [] } = useQuery<Suggestion[]>({
    queryKey: ['announcement-suggestions'],
    queryFn: async () => (await api.get('/api/communications/suggestions')).data,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['announcement-suggestions'] });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/api/communications/suggestions/${id}/dismiss`),
    onSuccess: () => { refresh(); toast.success('Suggestion dismissed'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  /**
   * "Add photos & announce": make the album once (pre-filled from the suggestion),
   * remember it on the suggestion, and go and fill it. A second click continues
   * with that album instead of making another.
   */
  const withPhotos = useMutation({
    mutationFn: async (s: Suggestion) => {
      if (s.albumId) return s.albumId;
      const album = (await api.post('/api/gallery/albums', {
        title: s.title,
        category: s.category,
        eventDate: new Date().toISOString().slice(0, 10),
        ...(s.projectId ? { projectId: s.projectId } : {}),
        ...(s.customerCompanyId ? { customerCompanyId: s.customerCompanyId } : {}),
      })).data as { id: string };
      await api.post(`/api/communications/suggestions/${s.id}/album`, { albumId: album.id });
      return album.id;
    },
    onSuccess: (albumId, s) => {
      refresh();
      qc.invalidateQueries({ queryKey: ['gallery-albums'] });
      navigate(`/gallery/${albumId}?suggestion=${s.id}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not create the album'),
  });

  // A toolbar button beside "New communication" — always there, with the pending
  // count as a badge; the list opens in a dialog.
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Lightbulb className="size-4" /> Suggested
        {suggestions.length > 0 && (
          <span className="ml-0.5 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{suggestions.length}</span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Suggested announcements</DialogTitle>
          </DialogHeader>
          {suggestions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing to suggest right now.</p>
          ) : (
      <div className="space-y-2">
        {suggestions.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-background px-3 py-2">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${categoryPill(s.category)}`}>
              {CATEGORY_LABEL[s.category] ?? s.category}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={s.title}>{s.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(s.createdAt)}</span>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" onClick={() => navigate(`/communications/new?suggestion=${s.id}`)}>
                <Megaphone className="size-4" /> Announce
              </Button>
              <Button size="sm" variant="outline" disabled={withPhotos.isPending} onClick={() => withPhotos.mutate(s)}>
                <ImagePlus className="size-4" /> {s.albumId ? 'Continue with photos' : 'Add photos & announce'}
              </Button>
              <Button size="icon" variant="ghost" className="size-8" title="Dismiss" disabled={dismiss.isPending} onClick={() => dismiss.mutate(s.id)}>
                <X className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
