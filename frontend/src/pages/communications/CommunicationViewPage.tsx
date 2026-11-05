import { useParams, useNavigate, Link } from 'react-router-dom';
import { assetUrl } from '@/lib/assetUrl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleCheck, CircleAlert, Clock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useDateFormat } from '../../lib/dateFormat';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { KIND_LABEL, STATUS_LABEL, kindPill, statusPill, type Communication } from './communicationsMeta';

/** Reading a sent communication. Admins also see how delivery went and who it failed for. */
export default function CommunicationViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const { fmtDateTime } = useDateFormat();

  const { data: c, isLoading, isError } = useQuery<Communication>({
    queryKey: ['communication', id],
    queryFn: async () => (await api.get(`/api/communications/${id}`)).data,
    refetchInterval: (q) => (q.state.data?.status === 'SENDING' ? 4000 : false),
  });
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api.post(`/api/communications/${id}/retry-failed`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['communication', id] });
      qc.invalidateQueries({ queryKey: ['communications'] });
      toast.success(`Retrying ${r.data.retrying} email(s)`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error retrying'),
  });

  const back = (
    <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/communications')}>
      <ArrowLeft className="size-4" /> Back to communications
    </Button>
  );
  if (isLoading) return <div>{back}<p className="text-muted-foreground">Loading…</p></div>;
  if (isError || !c) return <div>{back}<p className="text-muted-foreground">This communication isn't available.</p></div>;

  const paragraphs = c.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const d = c.delivery;

  return (
    <div className="max-w-3xl">
      {back}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${kindPill(c.kind)}`}>{KIND_LABEL[c.kind] ?? c.kind}</span>
        {isAdmin && <span className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${statusPill(c.status)}`}>{STATUS_LABEL[c.status] ?? c.status}</span>}
      </div>
      <h1 className="mb-1 text-2xl font-bold text-foreground">{c.subject}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {c.createdByName ? `From ${c.createdByName}` : 'Sent'}{c.sentAt ? ` · ${fmtDateTime(c.sentAt)}` : ''}
      </p>

      <Card className="mb-6">
        <CardContent className="space-y-3 py-6 text-sm leading-relaxed text-foreground">
          {paragraphs.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
          {/* Attached albums, live from the Gallery — one deleted since simply isn't shown. */}
          {(c.albums ?? []).map((a) => (
            <div key={a.id} className="border-t pt-4">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="font-semibold">{a.title}</span>
                <Link to={`/gallery/${a.id}`} className="shrink-0 text-xs text-primary hover:underline">
                  {a.photoCount > a.photos.length ? `View all ${a.photoCount} photos` : 'Open album'}
                </Link>
              </div>
              {a.photos.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {a.photos.map((p) => (
                    <Link key={p.id} to={`/gallery/${a.id}`} className="block overflow-hidden rounded-md bg-muted">
                      <img src={assetUrl(p.thumbUrl) ?? undefined} alt="" loading="lazy" className="aspect-square w-full object-cover transition-transform hover:scale-[1.03]" />
                    </Link>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">No photos in this album yet.</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      {isAdmin && d && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Delivery</CardTitle></CardHeader>
          <CardContent className="space-y-4 pb-5">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="text-muted-foreground">Delivered in the app to {c.recipientCount}.</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CircleCheck className="size-3.5" /> {d.sent} emailed
              </span>
              {d.pending > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                  <Clock className="size-3.5" /> {d.pending} still sending
                </span>
              )}
              {d.failed > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">
                  <CircleAlert className="size-3.5" /> {d.failed} failed
                </span>
              )}
              {d.failed > 0 && c.status === 'SENT' && (
                <Button size="sm" variant="outline" className="ml-auto" disabled={retry.isPending} onClick={() => retry.mutate()}>
                  <RotateCcw className="size-4" /> Retry failed
                </Button>
              )}
            </div>
            {d.failedList.length > 0 && (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="border-r text-xs font-semibold text-muted-foreground">Person</TableHead>
                      <TableHead className="border-r text-xs font-semibold text-muted-foreground">Email</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground">Why it failed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.failedList.map((f) => (
                      <TableRow key={f.email}>
                        <TableCell className="border-r">{f.name}</TableCell>
                        <TableCell className="border-r"><span className="block max-w-[14rem] truncate" title={f.email}>{f.email}</span></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{f.error || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
