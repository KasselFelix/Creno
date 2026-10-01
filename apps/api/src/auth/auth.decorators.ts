import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@creno/shared';
import type { AuthenticatedRequest, AuthUser } from './auth.types.js';

export const IS_PUBLIC = Symbol('IS_PUBLIC');
export const ROLES = Symbol('ROLES');

/** Route accessible sans être connecté. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route réservée à certains rôles (la propriété, elle, est vérifiée dans le service). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

/** Utilisateur connecté, posé sur la requête par `JwtAuthGuard`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new Error('@CurrentUser() utilisé sur une route @Public()');
    return user;
  },
);
