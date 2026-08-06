import { AlertTriangle, ChevronsUp } from 'lucide-react';

// At-a-glance priority symbol next to a task title (only the two that matter, to avoid clutter).
// Urgent → red triangle, High → amber double-chevron; nothing for Medium/Low.
export default function PriorityMark({ priority }: { priority?: string | null }) {
  if (priority === 'URGENT') {
    return <span title="Urgent" className="inline-flex shrink-0"><AlertTriangle className="size-3.5 text-destructive" /></span>;
  }
  if (priority === 'HIGH') {
    return <span title="High priority" className="inline-flex shrink-0"><ChevronsUp className="size-3.5 text-amber-500" /></span>;
  }
  return null;
}
