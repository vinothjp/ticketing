import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface ResolutionTicket {
  id: string;
  resolution?: string | null;
  resolvedAt?: string | null;
  reopenedCount?: number | null;
}

export default function ResolutionTab({ ticket }: { ticket: ResolutionTicket }) {
  const qc = useQueryClient();
  const [resolution, setResolution] = useState(ticket.resolution ?? '');

  useEffect(() => {
    setResolution(ticket.resolution ?? '');
  }, [ticket.id, ticket.resolvedAt]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tickets', ticket.id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticket.id] });
  };

  const save = useMutation({
    mutationFn: () => api.put(`/api/tickets/${ticket.id}/resolution`, { resolution }),
    onSuccess: () => { invalidate(); toast.success('Ticket resolved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving resolution'),
  });
  const reopen = useMutation({
    mutationFn: () => api.post(`/api/tickets/${ticket.id}/reopen`),
    onSuccess: () => { invalidate(); toast.success('Ticket reopened'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error reopening'),
  });

  const resolved = !!ticket.resolvedAt;

  return (
    <div className="max-w-2xl space-y-5">
      {resolved && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-emerald-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" />
            Resolved on {new Date(ticket.resolvedAt!).toLocaleString()}
            {(ticket.reopenedCount ?? 0) > 0 && <span className="text-muted-foreground">· reopened {ticket.reopenedCount}×</span>}
          </div>
          <Button variant="outline" size="sm" onClick={() => reopen.mutate()} disabled={reopen.isPending}>Reopen</Button>
        </div>
      )}

      {!resolved && !resolution.trim() && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          Please create a resolution message before resolving this ticket.
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Resolution notes</label>
        <Textarea rows={6} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Describe how the issue was resolved…" />
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending || !resolution.trim()}>
        {resolved ? 'Update resolution' : 'Mark resolved'}
      </Button>
    </div>
  );
}
