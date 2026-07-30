import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'fallback-secret',
    });
  }

  validate(payload: {
    sub: string;
    username: string;
    roles: string[];
    clientId: string | null;
    customerCompanyId?: string | null;
  }) {
    return {
      id: payload.sub,
      username: payload.username,
      roles: payload.roles,
      clientId: payload.clientId,
      customerCompanyId: payload.customerCompanyId ?? null,
    };
  }
}
