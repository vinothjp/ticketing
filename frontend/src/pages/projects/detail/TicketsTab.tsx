import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Link2, X, Search, Plus, Hash, AlignLeft, CircleDot } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { invalidateProject, type ProjectDetail } from '../projectMeta';

/**
 * A column heading: its icon, then its label. Muted and small, so the headings
 * read as chrome and the values below them carry the weight. Mirrors the
 * Change Management list.
 */
function HeadLabel({ icon: Icon, children, className = '' }: {
  icon: LucideIcon; children: ReactNode; className?: string;
}) {
  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground ${className}`}>
      <Icon className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

interface TicketRow {
  id: string;
  ticketNumber: string;
  subject: string;
  ticketStatus: string;
  priority?: string | null;
  projectId?: string | null;
}

export default function TicketsTab({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const [search, setSearch] = useState('');
  const invalidate = () => invalidateProject(qc);

  const { data: allTickets = [] } = useQuery<TicketRow[]>({
    queryKey: ['tickets'],
    queryFn: async () => (await api.get('/api/tickets')).data,
    enabled: linkOpen,
  });

  const linkMutation = useMutation({
    mutationFn: (ticketId: string) => api.post(`/api/projects/${project.id}/tickets/${ticketId}`),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['tickets'] }); toast.success('Ticket linked'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error linking ticket'),
  });

  const unlinkMutation = useMutation({
    mutationFn: (ticketId: string) => api.delete(`/api/projects/${project.id}/tickets/${ticketId}`),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['tickets'] }); toast.success('Ticket unlinked'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error unlinking ticket'),
  });

  const linkedIds = new Set(project.tickets.map((t) => t.id));
  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allTickets
      .filter((t) => !linkedIds.has(t.id) && !t.projectId)
      .filter((t) => !term || t.subject.toLowerCase().includes(term) || t.ticketNumber.toLowerCase().includes(term))
      .slice(0, 50);
  }, [allTickets, search, linkedIds]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {project.tickets.length} linked ticket{project.tickets.length === 1 ? '' : 's'}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.open(`/tickets/new?projectId=${project.id}`, '_blank', 'noopener')}><Plus className="size-4" /> Create Ticket</Button>
          <Button size="sm" onClick={() => setLinkOpen(true)}><Link2 className="size-4" /> Link Ticket</Button>
        </div>
      </div>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link a Ticket</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets..." className="pl-8" />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {candidates.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No unlinked tickets found.</p>}
            {candidates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => linkMutation.mutate(t.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="text-xs text-muted-foreground">{t.ticketNumber}</span>
                  <span className="ml-2 truncate text-foreground">{t.subject}</span>
                </span>
                <Badge variant="outline">{t.ticketStatus}</Badge>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-px border-r"><HeadLabel icon={Hash}>Number</HeadLabel></TableHead>
              <TableHead className="border-r"><HeadLabel icon={AlignLeft}>Subject</HeadLabel></TableHead>
              <TableHead className="w-px border-r"><HeadLabel icon={CircleDot}>Status</HeadLabel></TableHead>
              <TableHead className="w-px text-right text-xs font-semibold text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {project.tickets.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No linked tickets.</TableCell></TableRow>
            )}
            {project.tickets.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="border-r text-xs text-muted-foreground">
                  <Link to={`/tickets/${t.id}`} className="hover:underline">{t.ticketNumber}</Link>
                </TableCell>
                <TableCell className="border-r font-medium">
                  <Link to={`/tickets/${t.id}`} className="hover:underline">{t.subject}</Link>
                </TableCell>
                <TableCell className="border-r"><Badge variant="outline">{t.ticketStatus}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => unlinkMutation.mutate(t.id)}>
                    <X className="size-4" /> Unlink
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
