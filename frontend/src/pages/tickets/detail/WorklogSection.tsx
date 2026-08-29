import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDeleteWorklog, useWorklogs } from './ticketQueries';
import { useDateFormat } from '@/lib/dateFormat';

/**
 * The entries that belong to no task, at the foot of the Tasks tab.
 *
 * Task-linked hours are not repeated here — the grid above already totals them
 * per row, and each row's Log popover lists its own entries in full. What is
 * left are the orphans: time logged before a task was the only way in. They
 * still charge the customer's pool and still count in the header's running
 * total, so they need somewhere to be seen and corrected. Once a ticket has
 * none, the whole section disappears rather than sitting there empty.
 *
 * Read and delete only — hours are logged from a task's own row.
 */
export default function WorklogSection({ ticketId }: { ticketId: string }) {
  const { fmtDate } = useDateFormat();
  const { data: all = [] } = useWorklogs(ticketId);
  const remove = useDeleteWorklog(ticketId);

  const logs = all.filter((l) => !l.taskId);
  if (logs.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-foreground">Time not linked to a task</h3>
        <p className="text-xs text-muted-foreground">
          Logged against the ticket as a whole. Counts towards the customer's support hours.
        </p>
      </div>
      <div className="divide-y border-y">
      {logs.map((l) => (
        <div key={l.id} className="flex items-start gap-3 py-2.5">
          <div className="w-16 shrink-0 text-sm font-semibold text-foreground tabular-nums">{Number(l.hours)} h</div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">
              {fmtDate(l.workDate)}{l.consultantName ? ` · ${l.consultantName}` : ''}
            </div>
            {l.note && <div className="text-sm text-foreground">{l.note}</div>}
          </div>
          <Button
            size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
            title="Delete entry"
            onClick={() => remove.mutate(l.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      </div>
    </div>
  );
}
