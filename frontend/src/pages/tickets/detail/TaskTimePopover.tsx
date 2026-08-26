import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CellPopover } from '@/components/ui/cell-popover';
import { useAddWorklog, useDeleteWorklog, useWorklogs } from './ticketQueries';
import type { Task } from './TasksTab';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The Log time column of the task grid: the button that books hours against this
 * task, and the popover it opens.
 *
 * Time is spent on a task, so the control lives in the task's own row and the
 * entry it writes is linked to that task with no dropdown to re-pick. What it
 * writes is a `TicketWorklog` — the only thing that charges the customer's
 * support-hours pool. The neighbouring Time spent column is a different figure
 * entirely: derived from the status trail, audit only, never billed.
 */
export default function TaskTimePopover({ ticketId, task }: { ticketId: string; task: Task }) {
  const [hours, setHours] = useState('');
  const [workDate, setWorkDate] = useState(today());
  const [note, setNote] = useState('');

  const { data: allLogs = [] } = useWorklogs(ticketId);
  const add = useAddWorklog(ticketId);
  const remove = useDeleteWorklog(ticketId);

  // The whole ticket's entries are already in one cache entry — this row's share
  // is a filter, not a request of its own. The running total lives in the Time
  // spent column; this cell is the action alone.
  const logs = allLogs.filter((l) => l.taskId === task.id);

  const reset = () => { setHours(''); setWorkDate(today()); setNote(''); };
  const submit = (close: () => void) => {
    if (!(Number(hours) > 0) || add.isPending) return;
    add.mutate(
      { hours: Number(hours), workDate: workDate || undefined, note: note.trim() || undefined, taskId: task.id },
      { onSuccess: () => { reset(); close(); } },
    );
  };

  return (
    <>
      <CellPopover
        width={340}
        estimatedHeight={340}
        trigger={({ toggle }) => (
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={toggle} title="Log time on this task">
            <Plus className="size-3.5" /> Log
          </Button>
        )}
      >
        {(close) => (
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground">
              Log time on <span className="text-foreground">{task.title}</span>
            </div>

            {logs.length > 0 && (
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {logs.map((l) => (
                  <div key={l.id} className="flex items-start gap-2 rounded bg-muted/50 px-2 py-1.5">
                    <span className="w-12 shrink-0 text-sm font-semibold text-foreground tabular-nums">{Number(l.hours)} h</span>
                    {/* What the time was for leads; when and by whom is the
                        footnote under it. An entry with no note has nothing to
                        lead with, so the stamp takes the top line instead of
                        leaving a gap above it. */}
                    <div className="min-w-0 flex-1">
                      {l.note && <div className="text-sm whitespace-pre-wrap text-foreground">{l.note}</div>}
                      <div className={l.note ? 'text-[11px] text-muted-foreground' : 'text-sm text-muted-foreground'}>
                        {new Date(l.workDate).toLocaleDateString()}{l.consultantName ? ` · ${l.consultantName}` : ''}
                      </div>
                    </div>
                    <button
                      type="button" title="Delete entry"
                      onClick={() => remove.mutate(l.id)}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">Hours</label>
                <Input
                  className="h-8" type="number" min={0} step="0.25" autoFocus
                  value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 1.5"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Date</label>
                <Input className="h-8" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Note <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on?" />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
              <Button size="sm" onClick={() => submit(close)} disabled={!(Number(hours) > 0) || add.isPending}>
                {add.isPending ? 'Saving…' : 'Log time'}
              </Button>
            </div>
          </div>
        )}
      </CellPopover>
    </>
  );
}
