import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@creno/shared';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import type { AccessTokenPayload } from './auth.types.js';

const OPAQUE_TOKEN_FORMAT =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

/** Jeton opaque `<id>.<secret>` : refresh token (id de session) ou lien d'inscription (id de la demande en attente). */
export interface OpaqueTokenParts {
  id: string;
  secret: string;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get accessTtlMs(): number {
    return this.config.ACCESS_TOKEN_TTL_MINUTES * 60_000;
  }

  get refreshTtlMs(): number {
    return this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60_000;
  }

  signAccessToken(user: { id: string; role: UserRole }, sessionId: string): Promise<string> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, sid: sessionId };
    return this.jwt.signAsync(payload, { expiresIn: this.config.ACCESS_TOKEN_TTL_MINUTES * 60 });
  }

  /** Nouveau secret (256 bits) ; seul son hash est stocké en base. */
  newSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  formatToken(id: string, secret: string): string {
    return `${id}.${secret}`;
  }

  parseToken(token: unknown): OpaqueTokenParts | undefined {
    if (typeof token !== 'string') return undefined;
    const match = OPAQUE_TOKEN_FORMAT.exec(token);
    return match ? { id: match[1]!, secret: match[2]! } : undefined;
  }

  hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  /** Compare deux hash en temps constant. */
  sameHash(a: string | null | undefined, b: string): boolean {
    if (!a || a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
