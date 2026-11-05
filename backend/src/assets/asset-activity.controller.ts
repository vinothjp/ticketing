import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { AssetActivityService } from './asset-activity.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

type AuthedRequest = { user: { id: string; clientId: string; roles: string[] } };

/**
 * The asset audit trail. One endpoint answers both screens: `assetId` for the
 * unit's own history on the Asset Master form, `employeeUserId` for what one
 * person has held on their Employee Master screen.
 *
 * Admin-only, like the rest of the module — there is no `Viewer` hole here, since
 * an agent raising an asset request needs the free-asset list, not the history.
 */
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('Admin')
@Controller('api/asset-activity')
export class AssetActivityController {
  constructor(private activity: AssetActivityService) {}

  @Get()
  list(
    @Request() req: AuthedRequest,
    @Query('assetId') assetId?: string,
    @Query('employeeUserId') employeeUserId?: string,
    @Query('allocationId') allocationId?: string,
  ) {
    return this.activity.list(req.user.clientId, { assetId, employeeUserId, allocationId });
  }
}
