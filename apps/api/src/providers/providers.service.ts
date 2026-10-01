import { Injectable, Logger } from '@nestjs/common';
import { sqlState } from '@creno/db';
import type {
  CreateProviderInput,
  Provider,
  PublicProvider,
  ResourceList,
  UpdateProviderInput,
} from '@creno/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { DomainError } from '../common/domain-error.js';
import { mapPgError, pgConstraint } from '../common/pg-errors.js';
import { toResource } from '../resources/resources.mapper.js';
import { ResourcesRepository } from '../resources/resources.repository.js';
import { toProvider } from './providers.mapper.js';
import { type ProviderRow, ProvidersRepository } from './providers.repository.js';
import { slugify, withSuffix } from './slug.js';

const notFound = () => new DomainError('NOT_FOUND', 404, 'Prestataire introuvable.');
const SLUG_ATTEMPTS = 3;

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private readonly providers: ProvidersRepository,
    private readonly resources: ResourcesRepository,
  ) {}

  /** Un seul profil par compte : la contrainte unique sur `user_id` tranche en cas de course. */
  async create(current: AuthUser, input: CreateProviderInput): Promise<Provider> {
    let slug = slugify(input.name);
    for (let attempt = 1; ; attempt++) {
      try {
        const row = await this.providers.create(current.id, slug, input);
        this.logger.log({ event: 'provider.created', providerId: row.id, userId: current.id });
        return toProvider(row);
      } catch (error) {
        const slugTaken =
          sqlState(error) === '23505' && pgConstraint(error) === 'providers_slug_unique';
        if (!slugTaken || attempt >= SLUG_ATTEMPTS) {
          if (sqlState(error) === '23505' && !slugTaken) {
            throw new DomainError('ALREADY_EXISTS', 409, 'Votre profil prestataire existe déjà.');
          }
          throw mapPgError(error) ?? error;
        }
        // Un autre prestataire porte déjà ce nom : on garde le slug lisible, avec un suffixe.
        slug = withSuffix(slugify(input.name));
      }
    }
  }

  async me(current: AuthUser): Promise<Provider> {
    return toProvider(await this.requireMine(current));
  }

  /** Le slug ne change pas quand le nom change : l'adresse de la fiche publique reste stable. */
  async updateMe(current: AuthUser, input: UpdateProviderInput): Promise<Provider> {
    const mine = await this.requireMine(current);
    const row = await this.providers.update(mine.id, {
      name: input.name ?? mine.name,
      category: input.category ?? mine.category,
      description: input.description ?? mine.description,
      address: input.address ?? mine.address,
      city: input.city ?? mine.city,
      latitude: input.latitude ?? mine.latitude,
      longitude: input.longitude ?? mine.longitude,
    });
    if (!row) throw notFound();
    this.logger.log({ event: 'provider.updated', providerId: row.id, fields: Object.keys(input) });
    return toProvider(row);
  }

  async myResources(current: AuthUser): Promise<ResourceList> {
    const mine = await this.requireMine(current);
    const rows = await this.resources.listByProvider(mine.id, { activeOnly: false });
    return { items: rows.map(toResource) };
  }

  async getBySlug(slug: string): Promise<PublicProvider> {
    const row = await this.providers.findBySlug(slug);
    if (!row) throw notFound();
    const rows = await this.resources.listByProvider(row.id, { activeOnly: true });
    return { ...toProvider(row), resources: rows.map(toResource) };
  }

  private async requireMine(current: AuthUser): Promise<ProviderRow> {
    const row = await this.providers.findByUserId(current.id);
    if (!row) throw notFound();
    return row;
  }
}
