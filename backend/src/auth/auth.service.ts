import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private mailer: MailerService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: dto.username }, { email: dto.username }],
        isActive: true,
      },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.clientId) {
      const client = await this.prisma.client.findUnique({
        where: { id: user.clientId },
        include: { license: true },
      });

      if (!client || client.status !== 'ACTIVE') {
        throw new UnauthorizedException('Your organization access is suspended');
      }

      const license = client.license;
      if (!license || license.status !== 'ACTIVE' || license.expiryDate < new Date()) {
        throw new UnauthorizedException('Your organization license is inactive or has expired');
      }
    }

    const roles = user.userRoles.map((ur) => ur.role.name);
    const payload = { sub: user.id, username: user.username, roles, clientId: user.clientId };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles,
        clientId: user.clientId,
      },
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return { message: 'If that email exists, a reset link has been sent.' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExp: expiry },
    });

    const smtpConfig = await this.prisma.smtpConfig.findUnique({ where: { id: 'global' } });
    if (smtpConfig?.enabled && smtpConfig.host && smtpConfig.username && smtpConfig.passwordEncrypted) {
      try {
        const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
        const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
        await this.mailer.sendPasswordResetEmail(user.email, user.username, resetUrl);
      } catch (err) {
        // Don't let a broken SMTP config break password reset for users —
        // log it for the Super Admin to notice and fix in the SMTP settings.
        this.logger.error('Failed to send password reset email', err instanceof Error ? err.stack : err);
      }
      return { message: 'If that email exists, a reset link has been sent.' };
    }

    // SMTP not configured yet — fall back to returning the token so local
    // development can still exercise the reset flow without mail set up.
    return {
      message: 'If that email exists, a reset link has been sent.',
      devToken: token,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: dto.token,
        resetTokenExp: { gte: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExp: null },
    });

    return { message: 'Password reset successfully' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, updatedBy: userId },
    });

    return { message: 'Password changed successfully' };
  }

  async getMyClient(clientId: string | null) {
    if (!clientId) return null;
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { name: true, logoUrl: true },
    });
    return client;
  }

  async getMyPermissions(userId: string) {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            formPermissions: { include: { form: true } },
          },
        },
      },
    });

    const permissions: Record<string, Record<string, boolean>> = {};

    for (const ur of userRoles) {
      for (const fp of ur.role.formPermissions) {
        const formName = fp.form.name;
        if (!permissions[formName]) {
          permissions[formName] = {
            canCreate: false,
            canUpdate: false,
            canView: false,
            canDelete: false,
            canExport: false,
            canImport: false,
          };
        }
        // Merge permissions (OR logic — if any role grants it, user has it)
        permissions[formName].canCreate = permissions[formName].canCreate || fp.canCreate;
        permissions[formName].canUpdate = permissions[formName].canUpdate || fp.canUpdate;
        permissions[formName].canView = permissions[formName].canView || fp.canView;
        permissions[formName].canDelete = permissions[formName].canDelete || fp.canDelete;
        permissions[formName].canExport = permissions[formName].canExport || fp.canExport;
        permissions[formName].canImport = permissions[formName].canImport || fp.canImport;
      }
    }

    return permissions;
  }

  async checkPermission(userId: string, formName: string, action: string) {
    const permissions = await this.getMyPermissions(userId);
    const formPerms = permissions[formName];
    if (!formPerms) return { allowed: false };

    const actionMap: Record<string, string> = {
      create: 'canCreate',
      update: 'canUpdate',
      view: 'canView',
      delete: 'canDelete',
      export: 'canExport',
      import: 'canImport',
    };

    const key = actionMap[action.toLowerCase()];
    return { allowed: key ? !!formPerms[key] : false };
  }
}
