import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AUTH_COOKIES, userRoleSchema } from '@creno/shared';
import { DomainError } from '../common/domain-error.js';
import { IS_PUBLIC } from './auth.decorators.js';
import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types.js';

/**
 * Guard global : toute route exige un access token valide, sauf `@Public()`.
 * Le token vient du cookie `creno_at` (web) ou de `Authorization: Bearer` (futur mobile).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractAccessToken(req);
    if (!token) throw new DomainError('UNAUTHORIZED', 401, 'Connexion requise.');

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      req.user = {
        id: payload.sub,
        role: userRoleSchema.parse(payload.role),
        sessionId: payload.sid,
      };
      return true;
    } catch {
      throw new DomainError('UNAUTHORIZED', 401, 'Session expirée ou invalide.');
    }
  }
}

function extractAccessToken(req: AuthenticatedRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  const cookie: unknown = req.cookies?.[AUTH_COOKIES.access];
  return typeof cookie === 'string' && cookie.length > 0 ? cookie : undefined;
}
