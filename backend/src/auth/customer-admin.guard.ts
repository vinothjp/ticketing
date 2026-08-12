import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Allows only a customer company's own admin (the CustomerAdmin role). Used for
 * the self-service team-management endpoints — a customer admin manages only
 * their own company's employees; internal staff have no reach here.
 */
@Injectable()
export class CustomerAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user: { roles: string[]; customerCompanyId?: string | null } }>();
    if (!user?.roles?.includes('CustomerAdmin')) {
      throw new ForbiddenException('Only a customer company admin can manage team members');
    }
    if (!user.customerCompanyId) {
      throw new ForbiddenException('Your account is not linked to a customer company');
    }
    return true;
  }
}
