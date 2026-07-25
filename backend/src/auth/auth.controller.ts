import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CheckPermissionDto } from './dto/check-permission.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/permissions')
  getMyPermissions(@Request() req: { user: { id: string } }) {
    return this.authService.getMyPermissions(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/client')
  getMyClient(@Request() req: { user: { clientId: string | null } }) {
    return this.authService.getMyClient(req.user.clientId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(
    @Request() req: { user: { id: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('permissions/check')
  checkPermission(
    @Request() req: { user: { id: string } },
    @Body() dto: CheckPermissionDto,
  ) {
    return this.authService.checkPermission(req.user.id, dto.formName, dto.action);
  }
}
