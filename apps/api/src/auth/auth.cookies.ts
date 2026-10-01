import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { AUTH_COOKIES } from '@creno/shared';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import type { AuthResult } from './auth.service.js';
import { TokensService } from './tokens.service.js';

/**
 * Cookies `HttpOnly` : illisibles par JavaScript (un XSS ne peut pas voler les tokens).
 * Le navigateur ne parle qu'au domaine du front (rewrite `/api/*`) : cookies first-party.
 */
@Injectable()
export class AuthCookies {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tokens: TokensService,
  ) {}

  private base(): CookieOptions {
    return { httpOnly: true, secure: this.config.NODE_ENV === 'production', path: '/' };
  }

  set(res: Response, result: AuthResult): void {
    res.cookie(AUTH_COOKIES.access, result.accessToken, {
      ...this.base(),
      sameSite: 'lax',
      maxAge: this.tokens.accessTtlMs,
    });
    if (result.refreshToken) {
      // Strict : jamais envoyé depuis un autre site, même sur une navigation.
      res.cookie(AUTH_COOKIES.refresh, result.refreshToken, {
        ...this.base(),
        sameSite: 'strict',
        maxAge: this.tokens.refreshTtlMs,
      });
    }
  }

  clear(res: Response): void {
    res.clearCookie(AUTH_COOKIES.access, { ...this.base(), sameSite: 'lax' });
    res.clearCookie(AUTH_COOKIES.refresh, { ...this.base(), sameSite: 'strict' });
  }
}
