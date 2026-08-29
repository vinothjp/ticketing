import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';

type AuthedRequest = {
  user: { id: string; clientId: string; roles: string[]; customerCompanyId?: string | null };
};

// Open to everyone inside a tenant — the service, not the route, decides which
// result types a given viewer is allowed to see.
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/search')
export class SearchController {
  constructor(private search: SearchService) {}

  @Get()
  find(@Query('q') q: string | undefined, @Request() req: AuthedRequest) {
    return this.search.search(q ?? '', req.user.clientId, req.user);
  }
}
