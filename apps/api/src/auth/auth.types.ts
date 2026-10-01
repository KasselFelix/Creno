import type { UserRole } from '@creno/shared';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  role: UserRole;
  /** Session (appareil) d'où vient l'access token. */
  sessionId: string;
}

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  sid: string;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };
