import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, CalendarClock, Save, X, Images, Plus } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { useDateFormat } from '../../lib/dateFormat';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { COMMUNICATION_KINDS, KIND_LABEL, isOpen, type Communication, type Suggestion } from './communicationsMeta';
import { CATEGORY_LABEL, type AlbumSummary } from '../gallery/galleryMeta';

type Draft = { kind: string; subject: string; body: string; albumIds: string[] };
const EMPTY: Draft = { kind: 'ANNOUNCEMENT', subject: '', body: '', albumIds: [] };
/** The server's limits, mirrored: albums per communication, photos embedded per email. */
const MAX_ALBUMS = 10;
const MAX_EMAIL_PHOTOS = 6;

/** A first draft for announcing an album, by its category — the admin edits it before sending. */
const albumBody = (a: AlbumSummary) => {
  const opener: Record<string, string> = {
    PROJECT_INITIATIVE: `We're excited to share a new project initiative: ${a.title}.`,
    CLIENT_ACHIEVEMENT: `Great news — ${a.title}. Congratulations to everyone involved!`,
    UAT_SIGNOFF: `${a.title} — UAT has been signed off. Thank you to the team for all the hard work.`,
    AWARD: `We're proud to announce: ${a.title}.`,
  };
  return [opener[a.category] ?? a.title, a.description?.trim(), 'Photos below.'].filter(Boolean).join('\n\n');
};
const ym = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

/** The email as the recipient sees it: blank lines split paragraphs; attached albums underneath. */
function Preview({ kind, subject, body, albums }: Draft & { albums: AlbumSummary[] }) {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={cn('px-5 py-4 text-white', kind === 'NEWSLETTER' ? 'bg-indigo-600' : 'bg-teal-700')}>
        <div className="text-[11px] tracking-wide uppercase opacity-80">{KIND_LABEL[kind]}</div>
        <div className="mt-1 text-lg font-semibold">{subject || 'Subject'}</div>
      </div>
      <div className="space-y-3 bg-background px-5 py-4 text-sm leading-relaxed text-foreground">
        {paragraphs.length
          ? paragraphs.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)
          : <p className="text-muted-foreground">Your message appears here.</p>}
        {albums.map((a) => (
          <div key={a.id} className="border-t pt-3">
            <div className="mb-2 font-semibold">{a.title}</div>
            {a.coverUrl
              ? <img src={assetUrl(a.coverUrl) ?? undefined} alt="" className="aspect-[4/3] w-1/2 rounded object-cover" />
              : <p className="text-xs text-muted-foreground">No photos in this album yet.</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {a.photoCount} photo{a.photoCount === 1 ? '' : 's'} — the email embeds up to {MAX_EMAIL_PHOTOS} across all albums, with a link to the rest.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Write a communication, then save it as a draft, schedule it, or send it now.
 * Admin only (the route and the API both enforce it). Once sent it is a record
 * and opens read-only instead.
 */
export default function CommunicationEditorPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { fmtDateTime } = useDateFormat();
  const { confirm, ConfirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState('');

  const { data: record } = useQuery<Communication>({
    queryKey: ['communication', id],
    queryFn: async () => (await api.get(`/api/communications/${id}`)).data,
    enabled: editing,
  });
  const { data: audience } = useQuery<{ count: number }>({
    queryKey: ['communications-audience'],
    queryFn: async () => (await api.get('/api/communications/audience')).data,
  });
  const { data: allAlbums = [], isSuccess: albumsLoaded } = useQuery<AlbumSummary[]>({
    queryKey: ['gallery-albums'],
    queryFn: async () => (await api.get('/api/gallery/albums')).data,
  });
  const albumById = useMemo(() => new Map(allAlbums.map((a) => [a.id, a])), [allAlbums]);

  // Hydrate from the saved *content*, not the query object — a refetch on window
  // focus must not throw away what the admin is typing.
  const savedKey = record ? JSON.stringify([record.id, record.kind, record.subject, record.body, record.albumIds]) : '';
  useEffect(() => {
    if (record) setDraft({ kind: record.kind, subject: record.subject, body: record.body, albumIds: record.albumIds ?? [] });
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new announcement can start from an album (?albumId=, "Announce" on an album)
  // and/or a suggested announcement (?suggestion=, from the Communications screen).
  // The suggestion supplies the words, the album the photos. Prefilled once.
  const [params] = useSearchParams();
  const fromAlbum = !editing ? params.get('albumId') : null;
  const fromSuggestion = !editing ? params.get('suggestion') : null;
  const { data: suggestion, isError: suggestionGone } = useQuery<Suggestion>({
    queryKey: ['announcement-suggestion', fromSuggestion],
    queryFn: async () => (await api.get(`/api/communications/suggestions/${fromSuggestion}`)).data,
    enabled: !!fromSuggestion,
  });
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (prefilled || (!fromAlbum && !fromSuggestion) || !albumsLoaded) return;
    if (fromSuggestion && !suggestion && !suggestionGone) return; // still loading
    setPrefilled(true);
    const albumId = fromAlbum ?? suggestion?.albumId ?? null;
    const a = albumId ? albumById.get(albumId) : undefined;
    if (albumId && !a) toast.error('That album no longer exists');
    if (suggestion) {
      setDraft({
        kind: 'ANNOUNCEMENT', subject: suggestion.title,
        body: a && a.photoCount ? `${suggestion.body}\n\nPhotos below.` : suggestion.body,
        albumIds: a ? [a.id] : [],
      });
    } else if (a) {
      setDraft({ kind: 'ANNOUNCEMENT', subject: a.title, body: albumBody(a), albumIds: [a.id] });
    }
  }, [fromAlbum, fromSuggestion, suggestion, suggestionGone, prefilled, albumsLoaded, albumById]);

  const attached = draft.albumIds.map((aid) => albumById.get(aid)).filter((a): a is AlbumSummary => !!a);
  const attach = (ids: string[]) =>
    setDraft((d) => {
      const next = [...new Set([...d.albumIds, ...ids])];
      if (next.length > MAX_ALBUMS) toast.error(`At most ${MAX_ALBUMS} albums per communication`);
      return { ...d, albumIds: next.slice(0, MAX_ALBUMS) };
    });
  // Newsletter shortcuts: the albums dated this month and last month.
  const monthAlbums = (offset: number) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return {
      label: d.toLocaleString(undefined, { month: 'long' }),
      ids: allAlbums.filter((a) => ym(new Date(a.eventDate ?? a.createdAt)) === ym(d)).map((a) => a.id),
    };
  };

  // A sent communication is a record: open it read-only.
  useEffect(() => {
    if (record && !isOpen(record.status)) navigate(`/communications/${record.id}`, { replace: true });
  }, [record, navigate]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = !record || record.kind !== draft.kind || record.subject !== draft.subject.trim()
    || record.body !== draft.body.trim() || JSON.stringify(record.albumIds ?? []) !== JSON.stringify(draft.albumIds);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['communications'] });
    qc.invalidateQueries({ queryKey: ['communication', id] });
  };

  /** Save what's on screen; returns the id (new or existing). */
  const persist = async (): Promise<string> => {
    const body = { kind: draft.kind, subject: draft.subject.trim(), body: draft.body.trim(), albumIds: draft.albumIds };
    if (record) {
      if (dirty) await api.patch(`/api/communications/${record.id}`, body);
      return record.id;
    }
    const newId = (await api.post('/api/communications', body)).data.id as string;
    // Written from a suggestion: it has done its job and leaves the suggested list.
    if (suggestion?.status === 'PENDING') {
      await api.post(`/api/communications/suggestions/${suggestion.id}/used`, { communicationId: newId }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ['announcement-suggestions'] });
    }
    return newId;
  };

  const validate = () => {
    if (!draft.subject.trim()) { toast.error('Add a subject'); return false; }
    if (!draft.body.trim()) { toast.error('Write the message'); return false; }
    return true;
  };

  const saveDraft = useMutation({
    mutationFn: persist,
    onSuccess: (newId) => {
      invalidate();
      toast.success('Draft saved');
      if (!editing) navigate(`/communications/${newId}/edit`, { replace: true });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving'),
  });

  const sendNow = useMutation({
    mutationFn: async () => {
      const cid = await persist();
      await api.post(`/api/communications/${cid}/send`);
      return cid;
    },
    onSuccess: (cid) => { invalidate(); toast.success('Sending — everyone will have it in a few minutes'); navigate(`/communications/${cid}`); },
    onError: (e: any) => { invalidate(); toast.error(e.response?.data?.message || 'Error sending'); },
  });

  const schedule = useMutation({
    mutationFn: async () => {
      const cid = await persist();
      await api.post(`/api/communications/${cid}/schedule`, { scheduledAt: new Date(when).toISOString() });
      return cid;
    },
    onSuccess: () => { invalidate(); toast.success(`Scheduled for ${fmtDateTime(new Date(when))}`); navigate('/communications'); },
    onError: (e: any) => { invalidate(); toast.error(e.response?.data?.message || 'Error scheduling'); },
  });

  const unschedule = useMutation({
    mutationFn: () => api.post(`/api/communications/${id}/unschedule`),
    onSuccess: () => { invalidate(); toast.success('Back to draft — it will not be sent'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  });

  const busy = saveDraft.isPending || sendNow.isPending || schedule.isPending;

  const onSend = async () => {
    if (!validate()) return;
    const n = audience?.count ?? 0;
    if (await confirm({
      title: `Send to ${n} employee${n === 1 ? '' : 's'}?`,
      description: 'Everyone gets it by email and in the app straight away. A sent communication cannot be edited or recalled.',
      confirmText: 'Send now',
    })) sendNow.mutate();
  };

  const onSchedule = () => {
    if (!validate()) return;
    if (!when) { toast.error('Pick a date and time'); return; }
    if (new Date(when).getTime() <= Date.now() + 60_000) { toast.error('Pick a time at least a minute from now — or use Send now'); return; }
    schedule.mutate();
  };

  return (
    <div className="max-w-6xl">
      {ConfirmDialog}
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/communications')}>
        <ArrowLeft className="size-4" /> Back to communications
      </Button>
      <h1 className="mb-1 text-2xl font-bold text-foreground">{editing ? 'Edit communication' : 'New communication'}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Goes to all {audience ? `${audience.count} ` : ''}active employees, each by their own email and in the app.
      </p>

      {record?.status === 'SCHEDULED' && record.scheduledAt && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <CalendarClock className="size-4 shrink-0" />
          <span>Scheduled to send {fmtDateTime(record.scheduledAt)}. Changes you save go out with it.</span>
          <Button size="sm" variant="outline" className="ml-auto" disabled={unschedule.isPending} onClick={() => unschedule.mutate()}>
            <X className="size-4" /> Cancel schedule
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Card>
          <CardContent className="space-y-4 py-5">
            <div>
              <div className="mb-1.5 text-sm font-medium">Type</div>
              <div className="inline-flex rounded-lg border p-0.5">
                {COMMUNICATION_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => set('kind', k)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm transition-colors',
                      draft.kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium">Subject</div>
              <Input value={draft.subject} maxLength={200} onChange={(e) => set('subject', e.target.value)}
                placeholder={draft.kind === 'NEWSLETTER' ? 'e.g. October 2026 — what we shipped' : 'e.g. Office closed on Friday'} />
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium">Message</div>
              <Textarea rows={14} value={draft.body} onChange={(e) => set('body', e.target.value)}
                placeholder={'Write the message.\n\nLeave a blank line between paragraphs.'} />
            </div>

            {/* Gallery albums sent with it — their photos are embedded in the email. */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                <Images className="size-4 text-muted-foreground" /> Photos
                <span className="font-normal text-muted-foreground">(optional — albums from the Gallery)</span>
              </div>
              {attached.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {attached.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 rounded-lg border px-2 py-1.5">
                      {a.coverUrl
                        ? <img src={assetUrl(a.coverUrl) ?? undefined} alt="" className="size-10 shrink-0 rounded object-cover" />
                        : <div className="size-10 shrink-0 rounded bg-muted" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" title={a.title}>{a.title}</div>
                        <div className="text-xs text-muted-foreground">{CATEGORY_LABEL[a.category] ?? a.category} · {a.photoCount} photo{a.photoCount === 1 ? '' : 's'}</div>
                      </div>
                      <Button size="icon" variant="ghost" className="size-8" title="Remove"
                        onClick={() => set('albumIds', draft.albumIds.filter((x) => x !== a.id))}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Combobox
                  className="w-64" value="" placeholder="Attach an album…" emptyText="No albums to attach"
                  onChange={(v) => { if (v) attach([v]); }}
                  options={allAlbums.filter((a) => !draft.albumIds.includes(a.id)).map((a) => ({ value: a.id, label: a.title }))}
                />
                {draft.kind === 'NEWSLETTER' && [0, -1].map((offset) => {
                  const m = monthAlbums(offset);
                  const fresh = m.ids.filter((x) => !draft.albumIds.includes(x));
                  return (
                    <Button key={offset} size="sm" variant="outline"
                      onClick={() => {
                        if (!m.ids.length) toast.error(`No albums are dated ${m.label}`);
                        else if (!fresh.length) toast.message(`${m.label}'s albums are already attached`);
                        else attach(fresh);
                      }}>
                      <Plus className="size-4" /> {m.label}'s albums ({m.ids.length})
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button variant="outline" disabled={busy} onClick={() => { if (validate()) saveDraft.mutate(); }}>
                <Save className="size-4" /> Save draft
              </Button>
              {scheduling ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="datetime-local" className="w-56" value={when} onChange={(e) => setWhen(e.target.value)} />
                  <Button variant="outline" disabled={busy} onClick={onSchedule}><CalendarClock className="size-4" /> Schedule</Button>
                  <Button variant="ghost" size="sm" onClick={() => setScheduling(false)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => setScheduling(true)}>
                  <CalendarClock className="size-4" /> {record?.status === 'SCHEDULED' ? 'Reschedule…' : 'Schedule…'}
                </Button>
              )}
              <Button className="ml-auto" disabled={busy} onClick={onSend}>
                <Send className="size-4" /> {sendNow.isPending ? 'Sending…' : 'Send now'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Preview</CardTitle></CardHeader>
          <CardContent className="pb-5"><Preview {...draft} albums={attached} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
