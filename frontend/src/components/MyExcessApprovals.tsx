import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMyExcessRequests } from './excessHoursQueries';

/**
 * Banner listing the requests this user must decide, each linking to its pool.
 *
 * The decision itself is made inline on the pool's own screen (the product page,
 * or the client page on a shared contract) — this is only how an approver, often
 * a consultant with no reason to browse clients, finds what is waiting on them.
 */
export function MyExcessApprovals() {
  const navigate = useNavigate();
  const { data: mine = [] } = useMyExcessRequests();
  if (mine.length === 0) return null;

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <ShieldAlert className="size-4" />
        {mine.length} excess support-hours {mine.length === 1 ? 'request needs' : 'requests need'} your approval
      </div>
      {mine.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-foreground">
            {r.company?.name ?? 'A client'} · {r.productName ?? 'shared contract'}
          </span>
          <span className="text-xs text-muted-foreground">
            {r.requestedByName ?? 'A consultant'} asked to log beyond {r.allocated} h
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() =>
              navigate(
                r.scope === 'PRODUCT'
                  ? `/admin/clients/${r.customerCompanyId}/products/${r.ownerId}`
                  : `/admin/clients/${r.customerCompanyId}`,
              )
            }
          >
            Review
          </Button>
        </div>
      ))}
    </div>
  );
}
