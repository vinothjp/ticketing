import { useQuery } from '@tanstack/react-query';
import {
  Circle, Flag, UserPlus, CheckCircle2, RefreshCw, ListTodo, Stamp, Mail, Paperclip,
  Play, Ban, MessageSquare,
} from 'lucide-react';
import api from '../../../lib/api';
import { useDateFormat } from '@/lib/dateFormat';

interface Activity {
  id: string;
  type: string;
  summary: string;
  actorName?: string | null;
  createdAt: string;
}

const ICON: Record<string, typeof Circle> = {
  CREATED: Circle,
  STATUS_CHANGED: Flag,
  PRIORITY_CHANGED: Flag,
  ASSIGNED: UserPlus,
  RESOLVED: CheckCircle2,
  REOPENED: RefreshCw,
  CLOSED: CheckCircle2,
  ACKNOWLEDGED: CheckCircle2,
  TASK_ADDED: ListTodo,
  TASK_STARTED: Play,
  TASK_COMPLETED: CheckCircle2,
  TASK_CANCELLED: Ban,
  TASK_REOPENED: RefreshCw,
  TASK_STATUS_CHANGED: ListTodo,
  COMMENT_ADDED: MessageSquare,
  APPROVAL_REQUESTED: Stamp,
  APPROVAL_DECIDED: Stamp,
  APPROVAL_UPDATED: Stamp,
  APPROVAL_CANCELLED: Stamp,
  MESSAGE_SENT: Mail,
  MESSAGE_RECEIVED: Mail,
  ATTACHMENT_ADDED: Paperclip,
};

/**
 * How long ago, for anything inside a day. Past that it falls back to the stamp
 * itself, rendered in the tenant's own date format rather than the browser's —
 * hence the formatter argument.
 */
function relTime(iso: string, fmtDateTime: (v: string) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return fmtDateTime(iso);
}

export default function HistoryTab({ ticketId }: { ticketId: string }) {
  // A history is a record of *when*, so the stamp is always absolute — and in
  // the format this organization chose, not the one the browser happens to use.
  const { fmtDateTime } = useDateFormat();
  const { data: items = [] } = useQuery<Activity[]>({
    queryKey: ['ticket-activity', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/activity`)).data,
    refetchInterval: 15000,
  });

  if (!items.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;

  return (
    <ol className="space-y-4">
      {items.map((a) => {
        const Icon = ICON[a.type] ?? Circle;
        return (
          <li key={a.id} className="flex gap-3">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon className="size-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-foreground">{a.summary}</div>
              <div className="text-xs text-muted-foreground">
                {a.actorName ?? 'System'} · {fmtDateTime(a.createdAt)} · {relTime(a.createdAt, fmtDateTime)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
