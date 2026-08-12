import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Blocks external customer contacts from staff-only actions.
 *
 * The row-level scoping in TicketsService.findOne only proves a customer may
 * *see* a ticket (same company) — it does not stop them mutating it. Apply this
 * guard at the method level on staff-only mutations (assign technicians, set
 * resolution, edit status/priority, request approvals, manage tasks) so a
 * customer gets 403 even though they can open the ticket. Read endpoints and
 * customer-legitimate actions (create ticket, reply, reopen) stay ungated.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user: { roles: string[] } }>();
    // Both customer-side roles are external — a company admin still isn't our staff.
    const CUSTOMER_ROLES = ['Customer', 'CustomerAdmin'];
    if (user?.roles?.some((r) => CUSTOMER_ROLES.includes(r))) {
      throw new ForbiddenException('Customers cannot perform this action');
    }
    return true;
  }
}
