import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Search, Megaphone, Tag, CircleDot, Calendar, Users, AtSign } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useDateFormat } from '../../lib/dateFormat';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { KIND_LABEL, STATUS_LABEL, kindPill, statusPill, isOpen, type CommunicationRow } from './communicationsMeta';
import SuggestedAnnouncements from './SuggestedAnnouncements';

/** A column heading: its icon, then its label — the house table style. */
function HeadLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/**
 * Communications — announcements and the monthly newsletter. Every staff member
 * reads what has been sent here; an Admin also sees drafts and scheduled sends,
 * and writes new ones.
 */
export default function CommunicationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const { fmtDateTime } = useDateFormat();
  const { confirm, ConfirmDialog } = useConfirm();
  const [search, setSearch] = useState('');

  const { data: rows = [], isLoading } = useQuery<CommunicationRow[]>({
    queryKey: ['communications'],
    queryFn: async () => (await api.get('/api/communications')).data,
    // A send in progress settles by itself; keep the list honest while it does.
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === 'SENDING') ? 5000 : false),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/communications/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['communications'] }); toast.success('Deleted'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting'),
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.subject.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  /** The date that matters for the row: when it went out, when it will, or when it was last edited. */
  const when = (r: CommunicationRow) =>
    r.sentAt ? fmtDateTime(r.sentAt) : r.scheduledAt ? fmtDateTime(r.scheduledAt) : fmtDateTime(r.updatedAt);

  return (
    <div>
      {ConfirmDialog}
      <h1 className="mb-1 text-2xl font-bold text-foreground">Communications</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Announcements and the monthly newsletter, sent to every employee by email and in the app.
      </p>


      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by subject…" className="pl-8" />
        </div>
        {isAdmin && (
          <div className="ml-auto flex items-center gap-2">
            <SuggestedAnnouncements />
            <Button onClick={() => navigate('/communications/new')}>
              <Plus className="size-4" /> New communication
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="border-r"><HeadLabel icon={Megaphone}>Subject</HeadLabel></TableHead>
              <TableHead className="w-px border-r"><HeadLabel icon={Tag}>Type</HeadLabel></TableHead>
              {isAdmin && <TableHead className="w-px border-r"><HeadLabel icon={CircleDot}>Status</HeadLabel></TableHead>}
              <TableHead className="w-px border-r"><HeadLabel icon={Calendar}>Date</HeadLabel></TableHead>
              <TableHead className="w-px border-r"><HeadLabel icon={AtSign}>From</HeadLabel></TableHead>
              {isAdmin && <TableHead className="w-px border-r"><HeadLabel icon={Users}>Reached</HeadLabel></TableHead>}
              {isAdmin && <TableHead className="w-px" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {!isLoading && shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {search ? 'Nothing matches that search.' : 'No communications yet.'}
                </TableCell>
              </TableRow>
            )}
            {shown.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => navigate(isAdmin && isOpen(r.status) ? `/communications/${r.id}/edit` : `/communications/${r.id}`)}
              >
                <TableCell className="border-r font-medium">
                  <span className="block max-w-[28rem] truncate" title={r.subject}>{r.subject}</span>
                </TableCell>
                <TableCell className="border-r">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-bold whitespace-nowrap uppercase ${kindPill(r.kind)}`}>
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </span>
                </TableCell>
                {isAdmin && (
                  <TableCell className="border-r">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold whitespace-nowrap uppercase ${statusPill(r.status)}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </TableCell>
                )}
                <TableCell className="border-r text-sm whitespace-nowrap text-muted-foreground">{when(r)}</TableCell>
                <TableCell className="border-r text-sm whitespace-nowrap">{r.createdByName || '—'}</TableCell>
                {isAdmin && (
                  <TableCell className="border-r text-sm whitespace-nowrap tabular-nums">
                    {r.recipientCount ? (
                      <>
                        {r.recipientCount}
                        {r.failedCount > 0 && <span className="ml-1 text-destructive">({r.failedCount} failed)</span>}
                      </>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                {isAdmin && (
                  <TableCell className="w-px">
                    {isOpen(r.status) && (
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" className="size-8" title="Edit" onClick={() => navigate(`/communications/${r.id}/edit`)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" title="Delete"
                          onClick={async () => {
                            if (await confirm({ title: `Delete "${r.subject}"?`, description: 'It has not been sent, so nobody will miss it.', destructive: true, confirmText: 'Delete' })) remove.mutate(r.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
