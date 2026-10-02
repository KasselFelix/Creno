import { Inject, Injectable, Logger } from '@nestjs/common';
import { GEOCODING_RESULTS_MAX, type GeocodingQuery, type GeocodingResponse } from '@creno/shared';
import { DomainError } from '../common/domain-error.js';
import { GEOCODER, type Geocoder, GeocoderError } from './geocoder.js';

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(@Inject(GEOCODER) private readonly geocoder: Geocoder) {}

  async search(query: GeocodingQuery): Promise<GeocodingResponse> {
    const startedAt = Date.now();
    try {
      const items = await this.geocoder.search(query.q, GEOCODING_RESULTS_MAX);
      return { items: items.slice(0, GEOCODING_RESULTS_MAX) };
    } catch (error) {
      // Une erreur qui ne vient pas du géocodeur est un bug chez nous : elle remonte (500, `error`).
      if (!(error instanceof GeocoderError)) throw error;
      // Dégradé, pas une panne de notre côté : `warn`. Le texte saisi peut être une adresse
      // personnelle, on ne loggue que sa longueur.
      this.logger.warn({
        event: 'geocoding.failed',
        reason: error.reason,
        durationMs: Date.now() - startedAt,
        queryLength: query.q.length,
      });
      throw new DomainError(
        'GEOCODING_UNAVAILABLE',
        503,
        "La recherche d'adresse est momentanément indisponible.",
      );
    }
  }
}
