// Photo gallery — shared types and labels. Mirrors backend/src/gallery/.

export const ALBUM_CATEGORIES = ['PROJECT_INITIATIVE', 'CLIENT_ACHIEVEMENT', 'UAT_SIGNOFF', 'AWARD', 'OTHER'] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  PROJECT_INITIATIVE: 'Project initiative',
  CLIENT_ACHIEVEMENT: 'Client achievement',
  UAT_SIGNOFF: 'UAT / Sign-off',
  AWARD: 'Award',
  OTHER: 'Other',
};

export const categoryPill = (c: string) =>
  c === 'PROJECT_INITIATIVE' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
  : c === 'CLIENT_ACHIEVEMENT' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  : c === 'UAT_SIGNOFF' ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
  : c === 'AWARD' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';

/** The agreed limits — the server enforces the same numbers. */
export const MAX_PHOTOS_PER_UPLOAD = 10;
export const MAX_UPLOAD_MB = 15;

interface Ref { id: string; name: string }

export interface AlbumSummary {
  id: string;
  title: string;
  description: string | null;
  category: string;
  eventDate: string | null;
  project: Ref | null;
  customerCompany: Ref | null;
  photoCount: number;
  coverUrl: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface GalleryPhoto {
  id: string;
  fileUrl: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  originalName: string | null;
  caption: string | null;
}

export interface Album extends Omit<AlbumSummary, 'photoCount' | 'coverUrl'> {
  coverPhotoId: string | null;
  projectId: string | null;
  customerCompanyId: string | null;
  photos: GalleryPhoto[];
}
