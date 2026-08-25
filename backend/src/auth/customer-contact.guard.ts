import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Allows only an external customer contact — a company's own admin (CustomerAdmin)
 * or one of its employees (Customer) — acting for a company they belong to.
 *
 * The mirror image of StaffGuard: it gates actions that are the *client's* to take
 * (acknowledging a resolution) so internal staff cannot take them on the client's
 * behalf. Row-level scoping still happens in TicketsService.findOne, which limits
 * the viewer to their own company's tickets.
 *
 * Reopening follows the same rule but is enforced in TicketsService.reopen instead:
 * it turns on whether the ticket has a customer at all, which a guard can't see.
 */
@Injectable()
export class CustomerContactGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user: { roles: string[]; customerCompanyId?: string | null } }>();
    const CUSTOMER_ROLES = ['Customer', 'CustomerAdmin'];
    if (!user?.roles?.some((r) => CUSTOMER_ROLES.includes(r))) {
      throw new ForbiddenException('Only the client can acknowledge a resolution');
    }
    if (!user.customerCompanyId) {
      throw new ForbiddenException('Your account is not linked to a customer company');
    }
    return true;
  }
}
