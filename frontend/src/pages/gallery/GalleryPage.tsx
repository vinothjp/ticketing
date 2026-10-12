import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Images, ImageOff } from 'lucide-react';
import api from '../../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { useAuth } from '../../context/AuthContext';
import { useDateFormat } from '../../lib/dateFormat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import AlbumFormDialog from './AlbumFormDialog';
import { ALBUM_CATEGORIES, CATEGORY_LABEL, categoryPill, type AlbumSummary } from './galleryMeta';

/**
 * Photo gallery — project initiatives, client achievements, UAT / sign-off
 * photos and awards. Every staff member browses; Admins create albums.
 */
export default function GalleryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const { fmtDate } = useDateFormat();
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: albums = [], isLoading } = useQuery<AlbumSummary[]>({
    queryKey: ['gallery-albums'],
    queryFn: async () => (await api.get('/api/gallery/albums')).data,
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return albums.filter((a) =>
      (!category || a.category === category) &&
      (!q || a.title.toLowerCase().includes(q)
        || a.project?.name.toLowerCase().includes(q)
        || a.customerCompany?.name.toLowerCase().includes(q)));
  }, [albums, category, search]);

  const chip = (value: string, label: string) => (
    <button
      key={value || 'all'}
      type="button"
      onClick={() => setCategory(value)}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        category === value ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-foreground">Gallery</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Photos of project initiatives, client achievements, UAT / sign-off and awards.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search albums, projects, clients…" className="pl-8" />
        </div>
        {isAdmin && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New album
          </Button>
        )}
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {chip('', 'All')}
        {ALBUM_CATEGORIES.map((c) => chip(c, CATEGORY_LABEL[c]))}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-muted-foreground">
          <Images className="size-8" />
          <p className="text-sm">{albums.length ? 'No albums match.' : 'No albums yet.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => navigate(`/gallery/${a.id}`)}
              className="group overflow-hidden rounded-lg border bg-card text-left transition-shadow hover:shadow-md"
            >
              <div className="aspect-[4/3] bg-muted">
                {a.coverUrl ? (
                  <img src={assetUrl(a.coverUrl) ?? undefined} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground"><ImageOff className="size-7" /></div>
                )}
              </div>
              <div className="space-y-1.5 p-3">
                <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${categoryPill(a.category)}`}>
                  {CATEGORY_LABEL[a.category] ?? a.category}
                </span>
                <div className="truncate font-medium text-foreground" title={a.title}>{a.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[a.eventDate ? fmtDate(a.eventDate) : null, a.customerCompany?.name, `${a.photoCount} photo${a.photoCount === 1 ? '' : 's'}`]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <AlbumFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(id) => { setCreating(false); navigate(`/gallery/${id}`); }}
      />
    </div>
  );
}
