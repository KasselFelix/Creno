import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@creno/shared';
import { DomainError } from '../common/domain-error.js';
import { ROLES } from './auth.decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';

/** Vérifie `@Roles(...)` après `JwtAuthGuard`. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (user && roles.includes(user.role)) return true;
    throw new DomainError('FORBIDDEN', 403, 'Accès réservé.');
  }
}
