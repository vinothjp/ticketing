import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { useTicketComments } from './ticketQueries';

/**
 * One comment thread: the list, and the box to add to it.
 *
 * `taskId` picks which thread — omitted, this is the ticket's own. The same
 * component serves the task detail dialog and every group on the Comments tab,
 * so a comment reads and posts identically wherever it is written.
 */
export default function TaskComments({
  ticketId,
  taskId,
  placeholder = 'Add a comment…',
  emptyLabel = 'No comments yet.',
}: {
  ticketId: string;
  taskId?: string;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const [draft, setDraft] = useState('');

  const { data: all = [] } = useTicketComments(ticketId);
  const comments = all.filter((c) => (taskId ? c.taskId === taskId : !c.taskId));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket-comments', ticketId] });
    // The task row carries a comment count, and History gains an entry.
    qc.invalidateQueries({ queryKey: ['ticket-tasks', ticketId] });
    qc.invalidateQueries({ queryKey: ['ticket-task'] });
    qc.invalidateQueries({ queryKey: ['ticket-activity', ticketId] });
  };
  const post = useMutation({
    mutationFn: () =>
      api.post(`/api/tickets/${ticketId}/comments`, { body: draft.trim(), taskId }),
    onSuccess: () => { invalidate(); setDraft(''); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error posting comment'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/tickets/${ticketId}/comments/${id}`),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting comment'),
  });

  const submit = () => { if (draft.trim() && !post.isPending) post.mutate(); };

  return (
    <div className="space-y-3">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        comments.map((c) => (
          <div key={c.id} className="rounded-lg bg-muted/50 p-2.5">
            <div className="mb-0.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">{c.authorName || 'Someone'}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {new Date(c.createdAt).toLocaleString()}
                {(isAdmin || c.authorUserId === user?.id) && (
                  <button type="button" title="Delete comment" onClick={() => remove.mutate(c.id)}>
                    <Trash2 className="size-3.5 hover:text-destructive" />
                  </button>
                )}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap text-foreground">{c.body}</p>
          </div>
        ))
      )}
      <div className="flex gap-2">
        <Input
          className="h-9"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder={placeholder}
        />
        <Button size="sm" onClick={submit} disabled={!draft.trim() || post.isPending}>Post</Button>
      </div>
    </div>
  );
}
