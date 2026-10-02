import { Injectable, Logger } from '@nestjs/common';
import type { SearchProvidersQuery, SearchProvidersResponse } from '@creno/shared';
import { toSearchProvider } from './search.mapper.js';
import { SearchRepository } from './search.repository.js';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly repository: SearchRepository) {}

  async searchProviders(query: SearchProvidersQuery): Promise<SearchProvidersResponse> {
    const startedAt = Date.now();
    const hasCenter = query.lat !== undefined && query.lng !== undefined;
    const rows = await this.repository.searchProviders({
      center: hasCenter ? { latitude: query.lat!, longitude: query.lng! } : undefined,
      radiusMeters: query.radiusKm * 1000,
      category: query.category,
      priceMaxCents: query.priceMax,
      limit: query.limit,
    });
    const total = rows[0]?.total ?? 0;

    // La position du visiteur est une donnée personnelle : jamais de coordonnées dans les logs.
    this.logger.log({
      event: 'search.performed',
      hasCenter,
      radiusKm: hasCenter ? query.radiusKm : undefined,
      category: query.category,
      hasPriceMax: query.priceMax !== undefined,
      total,
      durationMs: Date.now() - startedAt,
    });
    return { items: rows.map(toSearchProvider), total };
  }
}
