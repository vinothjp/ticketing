import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { MailerService } from '../mail/mailer.service';

const PASSWORD = 'SuperAdmin@123';

function userRow(roles: string[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'superadmin',
    email: 'root@example.com',
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    isActive: true,
    clientId: null,
    customerCompanyId: null,
    userRoles: roles.map((name) => ({ role: { name } })),
    ...overrides,
  };
}

function build(env: Record<string, string | undefined>, user: Record<string, unknown>) {
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(user),
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    client: { findUnique: jest.fn() },
  } as unknown as PrismaService;
  const jwt = { sign: jest.fn().mockReturnValue('signed.jwt') } as unknown as JwtService;
  const config = { get: jest.fn((k: string) => env[k]) } as unknown as ConfigService;
  return new AuthService(prisma, jwt, config, {} as MailerService);
}

const OTP_ENV = { OTP_SERVICE_URL: 'http://otp:3001', OTP_SERVICE_API_KEY: 'k' };
const login = (svc: AuthService) => svc.login({ username: 'superadmin', password: PASSWORD } as any);

describe('AuthService SuperAdmin 2FA (fail closed)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('refuses SuperAdmin sign-in when the OTP service is not configured', async () => {
    const svc = build({}, userRow(['SuperAdmin']));
    await expect(login(svc)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses SuperAdmin sign-in when the OTP send fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const svc = build(OTP_ENV, userRow(['SuperAdmin']));
    await expect(login(svc)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns a challenge, never a token, when the code is sent', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ challengeId: 'ch-1' }) }) as any;
    const svc = build(OTP_ENV, userRow(['SuperAdmin']));
    const res: any = await login(svc);
    expect(res.requiresOtp).toBe(true);
    expect(res.challengeId).toBe('ch-1');
    expect(res.accessToken).toBeUndefined();
  });

  it('SUPER_ADMIN_OTP=false is the only bypass', async () => {
    const svc = build({ SUPER_ADMIN_OTP: 'false' }, userRow(['SuperAdmin']));
    const res: any = await login(svc);
    expect(res.accessToken).toBeDefined();
  });

  it('non-SuperAdmin users are unaffected by the gate', async () => {
    const svc = build({}, userRow(['Admin'], { clientId: null }));
    const res: any = await login(svc);
    expect(res.accessToken).toBeDefined();
  });

  it('verify-otp: a correct code issues tokens', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ challengeId: 'ch-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true }) }) as any;
    const svc = build(OTP_ENV, userRow(['SuperAdmin']));
    await login(svc);
    const res: any = await svc.verifyOtp({ challengeId: 'ch-1', otp: '123456' });
    expect(res.accessToken).toBeDefined();
  });

  it('verify-otp: a wrong code issues nothing', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ challengeId: 'ch-1' }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ valid: false, attemptsLeft: 2 }) }) as any;
    const svc = build(OTP_ENV, userRow(['SuperAdmin']));
    await login(svc);
    await expect(svc.verifyOtp({ challengeId: 'ch-1', otp: '000000' })).rejects.toThrow('2 attempt(s) left');
  });

  it('verify-otp: refuses a user deactivated or demoted while the code was pending', async () => {
    for (const later of [userRow(['SuperAdmin'], { isActive: false }), userRow(['Admin'])]) {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ challengeId: 'ch-1' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true }) }) as any;
      const svc = build(OTP_ENV, userRow(['SuperAdmin']));
      await login(svc);
      ((svc as any).prisma.user.findUnique as jest.Mock).mockResolvedValue(later);
      await expect(svc.verifyOtp({ challengeId: 'ch-1', otp: '123456' })).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });
});
