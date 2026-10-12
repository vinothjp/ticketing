// Communication emails & newsletter — shared types and labels for the three screens.
// Mirrors backend/src/communications/.

export const COMMUNICATION_KINDS = ['ANNOUNCEMENT', 'NEWSLETTER'] as const;
export type CommunicationKind = (typeof COMMUNICATION_KINDS)[number];

export const KIND_LABEL: Record<string, string> = { ANNOUNCEMENT: 'Announcement', NEWSLETTER: 'Newsletter' };
export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SCHEDULED: 'Scheduled', SENDING: 'Sending', SENT: 'Sent',
};

export interface CommunicationRow {
  id: string;
  kind: string;
  subject: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  failedCount: number;
  createdByName: string | null;
  updatedAt: string;
}

/** An attached gallery album as the read view shows it. */
export interface AttachedAlbum {
  id: string;
  title: string;
  category: string;
  eventDate: string | null;
  photoCount: number;
  photos: { id: string; thumbUrl: string }[];
}

export interface Communication extends CommunicationRow {
  body: string;
  albumIds: string[];
  albums: AttachedAlbum[];
  /** Admins only. */
  delivery?: {
    sent: number;
    failed: number;
    pending: number;
    failedList: { name: string; email: string; error: string | null }[];
  };
}

/** An "Announce this?" prompt raised by a Projects event. */
export interface Suggestion {
  id: string;
  kind: string;
  /** The gallery album category it maps to. */
  category: string;
  title: string;
  body: string;
  projectId: string | null;
  customerCompanyId: string | null;
  albumId: string | null;
  status: string;
  createdAt: string;
}

/** Only these can still be edited, rescheduled or deleted. */
export const isOpen = (status: string) => status === 'DRAFT' || status === 'SCHEDULED';

export const kindPill = (k: string) =>
  k === 'NEWSLETTER'
    ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300'
    : 'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300';

export const statusPill = (s: string) =>
  s === 'SENT' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  : s === 'SENDING' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
  : s === 'SCHEDULED' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
