import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { withImpliedRoles } from './implied-roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user: { roles: string[] } }>();
    // A Manager holds every right of an agent (Viewer) — see implied-roles.ts.
    const allowed = withImpliedRoles(user?.roles).some((role) => requiredRoles.includes(role));
    if (!allowed) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
