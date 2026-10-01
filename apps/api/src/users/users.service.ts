import { Injectable, Logger } from '@nestjs/common';
import type { Pagination, PublicUser, UpdateMeInput, UserList } from '@creno/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { DomainError } from '../common/domain-error.js';
import { toPublicUser } from './users.mapper.js';
import { UsersRepository } from './users.repository.js';

const notFound = () => new DomainError('NOT_FOUND', 404, 'Utilisateur introuvable.');

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly users: UsersRepository) {}

  async me(current: AuthUser): Promise<PublicUser> {
    return this.getById(current, current.id);
  }

  /** Propriété vérifiée ici : un utilisateur ne lit que lui-même, un admin lit tout le monde. */
  async getById(current: AuthUser, id: string): Promise<PublicUser> {
    // Contrôle avant la lecture en base : un non-admin n'apprend même pas si l'id existe.
    if (current.role !== 'admin' && current.id !== id) {
      throw new DomainError(
        'FORBIDDEN_OWNERSHIP',
        403,
        'Vous ne pouvez consulter que votre propre compte.',
      );
    }
    const user = await this.users.findById(id);
    if (!user) throw notFound();
    return toPublicUser(user);
  }

  async updateMe(current: AuthUser, input: UpdateMeInput): Promise<PublicUser> {
    const user = await this.users.update(current.id, input);
    if (!user) throw notFound();
    this.logger.log({ event: 'user.updated', userId: current.id, fields: Object.keys(input) });
    return toPublicUser(user);
  }

  async list(pagination: Pagination): Promise<UserList> {
    const { rows, total } = await this.users.list(pagination);
    return { items: rows.map(toPublicUser), total };
  }
}
