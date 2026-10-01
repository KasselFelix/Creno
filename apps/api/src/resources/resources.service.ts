import { Injectable, Logger } from '@nestjs/common';
import type { CreateResourceInput, Resource, UpdateResourceInput } from '@creno/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { DomainError } from '../common/domain-error.js';
import { mapPgError } from '../common/pg-errors.js';
import { toResource } from './resources.mapper.js';
import { type ResourceRow, ResourcesRepository } from './resources.repository.js';

const notFound = () => new DomainError('NOT_FOUND', 404, 'Ressource introuvable.');

@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);

  constructor(private readonly resources: ResourcesRepository) {}

  async create(current: AuthUser, input: CreateResourceInput): Promise<Resource> {
    const providerId = await this.resources.providerIdOfUser(current.id);
    if (!providerId) {
      throw new DomainError(
        'PROVIDER_PROFILE_REQUIRED',
        409,
        "Créez votre profil prestataire avant d'ajouter une ressource.",
      );
    }
    try {
      const row = await this.resources.create(providerId, input);
      this.logger.log({ event: 'resource.created', resourceId: row.id, providerId });
      return toResource(row);
    } catch (error) {
      throw mapPgError(error) ?? error;
    }
  }

  /** Lecture publique : une ressource désactivée n'existe pas pour les visiteurs. */
  async getPublic(id: string): Promise<Resource> {
    return toResource(await this.requireActive(id));
  }

  async update(current: AuthUser, id: string, input: UpdateResourceInput): Promise<Resource> {
    await this.requireOwned(current, id);
    try {
      const row = await this.resources.update(id, input);
      if (!row) throw notFound();
      this.logger.log({ event: 'resource.updated', resourceId: id, fields: Object.keys(input) });
      return toResource(row);
    } catch (error) {
      throw mapPgError(error) ?? error;
    }
  }

  async requireExisting(id: string): Promise<ResourceRow> {
    const row = await this.resources.findById(id);
    if (!row) throw notFound();
    return row;
  }

  async requireActive(id: string): Promise<ResourceRow> {
    const row = await this.resources.findById(id);
    if (!row?.isActive) throw notFound();
    return row;
  }

  /** Propriété vérifiée ici : la ressource doit appartenir au profil prestataire de l'utilisateur. */
  async requireOwned(current: AuthUser, id: string): Promise<ResourceRow> {
    const row = await this.resources.findWithOwner(id);
    if (!row) throw notFound();
    if (row.ownerUserId !== current.id) {
      throw new DomainError(
        'FORBIDDEN_OWNERSHIP',
        403,
        'Cette ressource appartient à un autre prestataire.',
      );
    }
    return row;
  }
}
