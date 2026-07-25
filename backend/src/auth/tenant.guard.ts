import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user: { clientId: string | null } }>();
    if (!user?.clientId) {
      throw new ForbiddenException('This resource is only available to client users');
    }
    return true;
  }
}
