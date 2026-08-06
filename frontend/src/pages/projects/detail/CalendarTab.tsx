import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '../../../context/AuthContext';
import { type ProjectDetail } from '../projectMeta';

type Ev = { date: Date; label: string; kind: 'milestone' | 'task' };
const KIND_COLOR: Record<Ev['kind'], string> = { milestone: 'bg-primary', task: 'bg-amber-500' };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function CalendarTab({ project }: { project: ProjectDetail }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const { user } = useAuth();
  const isAdmin = !!user?.roles.includes('Admin');
  const myId = user?.id ?? null;

  const events = useMemo<Ev[]>(() => {
    const evs: Ev[] = [];
    // Milestones are shared with everyone; agents see only their own task due-dates.
    for (const m of project.milestones) if (m.targetDate) evs.push({ date: new Date(m.targetDate), label: m.name, kind: 'milestone' });
    for (const t of project.tasks) {
      if (t.dueDate && !t.isParent && (isAdmin || t.assigneeUserId === myId)) {
        evs.push({ date: new Date(t.dueDate), label: t.title, kind: 'task' });
      }
    }
    return evs;
  }, [project.milestones, project.tasks, isAdmin, myId]);

  // Build the 6-week grid starting on the Sunday on/before the 1st.
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  const today = new Date();
  const monthLabel = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const move = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" className="size-8" onClick={() => move(-1)}><ChevronLeft className="size-4" /></Button>
          <span className="w-40 text-center text-sm font-medium">{monthLabel}</span>
          <Button size="icon" variant="outline" className="size-8" onClick={() => move(1)}><ChevronRight className="size-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" /> Milestone</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" /> Task due</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const dayEvents = events.filter((e) => sameDay(e.date, d));
            return (
              <div key={i} className={`min-h-20 border-b border-r p-1 ${inMonth ? '' : 'bg-muted/20 text-muted-foreground'}`}>
                <div className={`mb-1 text-xs ${sameDay(d, today) ? 'flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground' : ''}`}>{d.getDate()}</div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((e, j) => (
                    <div key={j} className="flex items-center gap-1 truncate text-[11px]" title={e.label}>
                      <span className={`size-1.5 shrink-0 rounded-full ${KIND_COLOR[e.kind]}`} />
                      <span className="truncate">{e.label}</span>
                    </div>
                  ))}
                  {dayEvents.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
