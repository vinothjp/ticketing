import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DateField } from '@/components/ui/date-field';
import { Combobox } from '@/components/ui/combobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ALBUM_CATEGORIES, CATEGORY_LABEL, type Album } from './galleryMeta';

type Form = {
  title: string; category: string; eventDate: string; description: string;
  projectId: string; customerCompanyId: string;
};
const blank = (): Form => ({
  title: '', category: 'OTHER', eventDate: new Date().toISOString().slice(0, 10), description: '',
  projectId: '', customerCompanyId: '',
});

/** Create or edit an album's details. Photos are added on the album page itself. */
export default function AlbumFormDialog({
  open, album, onClose, onSaved,
}: {
  open: boolean;
  album?: Album | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setForm(album ? {
      title: album.title,
      category: album.category,
      eventDate: album.eventDate ? album.eventDate.slice(0, 10) : '',
      description: album.description ?? '',
      projectId: album.projectId ?? '',
      customerCompanyId: album.customerCompanyId ?? '',
    } : blank());
  }, [open, album]);

  const { data: projects = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['projects', 'picker'],
    queryFn: async () => (await api.get('/api/projects')).data,
    enabled: open,
  });
  const { data: clients = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['customer-companies', 'picker'],
    queryFn: async () => (await api.get('/api/customer-companies')).data,
    enabled: open,
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title.trim(),
        category: form.category,
        description: form.description.trim() || (album ? null : undefined),
        eventDate: form.eventDate || (album ? null : undefined),
        projectId: form.projectId || (album ? null : undefined),
        customerCompanyId: form.customerCompanyId || (album ? null : undefined),
      };
      return album
        ? (await api.patch(`/api/gallery/albums/${album.id}`, body)).data
        : (await api.post('/api/gallery/albums', body)).data;
    },
    onSuccess: (saved: { id: string }) => {
      qc.invalidateQueries({ queryKey: ['gallery-albums'] });
      qc.invalidateQueries({ queryKey: ['gallery-album', saved.id] });
      toast.success(album ? 'Album saved' : 'Album created — now add photos');
      onSaved(saved.id);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving album'),
  });

  const submit = () => {
    if (!form.title.trim()) { toast.error('Give the album a title'); return; }
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{album ? 'Edit album' : 'New album'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm font-medium">Title</div>
            <Input value={form.title} maxLength={150} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Globex ERP go-live" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-sm font-medium">Category</div>
              <Select value={form.category} onValueChange={(v) => { if (v) set('category', v); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>{ALBUM_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Date</div>
              <DateField value={form.eventDate} onChange={(v) => set('eventDate', v)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-sm font-medium">Project <span className="font-normal text-muted-foreground">(optional)</span></div>
              <Combobox
                value={form.projectId} placeholder="None" emptyText="No matching project"
                onChange={(v) => set('projectId', v)}
                options={[{ value: '', label: 'None' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Client <span className="font-normal text-muted-foreground">(optional)</span></div>
              <Combobox
                value={form.customerCompanyId} placeholder="None" emptyText="No matching client"
                onChange={(v) => set('customerCompanyId', v)}
                options={[{ value: '', label: 'None' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Description <span className="font-normal text-muted-foreground">(optional)</span></div>
            <Textarea rows={3} value={form.description} maxLength={2000} onChange={(e) => set('description', e.target.value)} placeholder="What happened, who was there…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={submit}>{album ? 'Save' : 'Create album'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
