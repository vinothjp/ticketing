import { Clock3 } from 'lucide-react';

export default function TimesheetComingSoonPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Timesheet</h1>
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-24 text-center">
        <Clock3 className="mb-3 size-8 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">Coming soon</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          A cross-project timesheet for logging and approving time will live here. For now, log time inside a project's Timesheet tab.
        </p>
      </div>
    </div>
  );
}
