import { Injectable, Logger } from '@nestjs/common';
import {
  BOOKING_HORIZON_DAYS,
  isSearchDateInRange,
  SEARCH_DATE_CANDIDATES_MAX,
  SEARCH_TIMEZONE,
  type SearchProvidersQuery,
  type SearchProvidersResponse,
} from '@creno/shared';
import { AvailabilityService } from '../availability/availability.service.js';
import { localDateOf } from '../availability/slots.engine.js';
import { DomainError } from '../common/domain-error.js';
import { toSearchProvider } from './search.mapper.js';
import { SearchRepository } from './search.repository.js';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly repository: SearchRepository,
    private readonly availability: AvailabilityService,
  ) {}

  /** `now` en paramètre, comme pour `getSlots` : les tests fixent l'instant. */
  async searchProviders(
    query: SearchProvidersQuery,
    now = new Date(),
  ): Promise<SearchProvidersResponse> {
    const startedAt = Date.now();
    const { date } = query;
    // La plage se lit à l'heure de Paris ; les créneaux, eux, au fuseau de chaque ressource.
    if (date !== undefined && !isSearchDateInRange(date, localDateOf(now, SEARCH_TIMEZONE))) {
      throw new DomainError(
        'SEARCH_DATE_OUT_OF_RANGE',
        400,
        `Choisissez une date entre aujourd'hui et dans ${BOOKING_HORIZON_DAYS} jours.`,
      );
    }
    const hasCenter = query.lat !== undefined && query.lng !== undefined;
    const rows = await this.repository.searchProviders({
      center: hasCenter ? { latitude: query.lat!, longitude: query.lng! } : undefined,
      radiusMeters: query.radiusKm * 1000,
      category: query.category,
      priceMaxCents: query.priceMax,
      // Avec une date, on examine plus de candidats : une partie n'aura pas de créneau libre.
      limit: date === undefined ? query.limit : SEARCH_DATE_CANDIDATES_MAX,
    });
    const matching = rows[0]?.total ?? 0;

    let response: SearchProvidersResponse;
    if (date === undefined) {
      // Sans date, la requête compte tous les prestataires qui correspondent : le total est exact.
      response = {
        items: rows.map((row) => toSearchProvider(row)),
        total: matching,
        totalIsCapped: false,
      };
    } else {
      const free = await this.availability.freeSlotsOn(
        rows.map((row) => row.id),
        date,
        { priceMaxCents: query.priceMax },
        now,
      );
      // `rows` est déjà dans l'ordre voulu (distance, ou nom sans centre) : on le garde.
      const available = rows.filter((row) => free.has(row.id));
      response = {
        items: available
          .slice(0, query.limit)
          .map((row) => toSearchProvider(row, free.get(row.id))),
        total: available.length,
        totalIsCapped: matching > SEARCH_DATE_CANDIDATES_MAX,
      };
    }

    // La position du visiteur est une donnée personnelle : jamais de coordonnées dans les logs.
    this.logger.log({
      event: 'search.performed',
      hasCenter,
      radiusKm: hasCenter ? query.radiusKm : undefined,
      category: query.category,
      hasPriceMax: query.priceMax !== undefined,
      hasDate: date !== undefined,
      total: response.total,
      totalIsCapped: response.totalIsCapped,
      durationMs: Date.now() - startedAt,
    });
    return response;
  }
}
