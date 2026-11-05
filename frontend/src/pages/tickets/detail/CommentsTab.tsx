import { useQuery } from '@tanstack/react-query';
import { MessageSquare, ListTodo } from 'lucide-react';
import api from '../../../lib/api';
import { Badge } from '@/components/ui/badge';
import TaskComments from './TaskComments';
import { useTicketComments } from './ticketQueries';
import { taskStatusLabel, taskStatusVariant } from './taskMeta';
import type { Task } from './TasksTab';

/**
 * Every comment on the ticket in one place: its own thread, then a group for each
 * task that has one. A comment written inside a task's dialog surfaces here
 * without being retyped, which is the whole point of the tab.
 *
 * Tasks are staff-only, so a customer sees the ticket thread alone — the task
 * query is skipped for them and the API filters task comments out regardless.
 */
export default function CommentsTab({ ticketId, isStaff }: { ticketId: string; isStaff: boolean }) {
  const { data: comments = [] } = useTicketComments(ticketId);
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['ticket-tasks', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/tasks`)).data,
    enabled: isStaff,
  });

  // Only tasks that have actually been commented on — an empty group per task
  // would bury the ticket's own thread under a wall of "no comments yet".
  const commentedTaskIds = new Set(comments.map((c) => c.taskId).filter(Boolean));
  const groups = tasks.filter((t) => commentedTaskIds.has(t.id));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <MessageSquare className="size-4 text-muted-foreground" /> On this ticket
        </h3>
        <TaskComments
          ticketId={ticketId}
          placeholder="Add a comment on this ticket…"
          emptyLabel="No comments on the ticket yet."
        />
      </section>

      {isStaff && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ListTodo className="size-4 text-muted-foreground" /> On its tasks
            <span className="text-xs text-muted-foreground">{groups.length}</span>
          </h3>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No task has been commented on yet — open a task on the Tasks tab to start a thread.
            </p>
          ) : (
            groups.map((t) => (
              <div key={t.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{t.title}</span>
                  <Badge variant={taskStatusVariant(t.status)}>{taskStatusLabel(t.status)}</Badge>
                  <span className="text-xs text-muted-foreground">{t.assigneeName ?? 'Unassigned'}</span>
                </div>
                <TaskComments
                  ticketId={ticketId}
                  taskId={t.id}
                  placeholder="Reply on this task…"
                  emptyLabel="No comments on this task yet."
                />
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}
