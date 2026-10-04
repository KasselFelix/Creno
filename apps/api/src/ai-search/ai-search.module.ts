import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { GeocodingModule } from '../geocoding/geocoding.module.js';
import { AiRequestsRepository } from './ai-requests.repository.js';
import { AiSearchController } from './ai-search.controller.js';
import { AiSearchService } from './ai-search.service.js';
import { CircuitBreaker } from './circuit-breaker.js';
import {
  AI_FILTER_EXTRACTOR,
  type FilterExtractor,
  UnconfiguredFilterExtractor,
} from './filter-extractor.js';
import { MistralFilterExtractor } from './mistral-filter-extractor.js';

@Module({
  imports: [GeocodingModule],
  controllers: [AiSearchController],
  providers: [
    AiRequestsRepository,
    AiSearchService,
    // Un circuit par réplica, partagé par toutes les requêtes de ce processus.
    {
      provide: CircuitBreaker,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new CircuitBreaker(clock),
    },
    {
      provide: AI_FILTER_EXTRACTOR,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): FilterExtractor =>
        config.MISTRAL_API_KEY
          ? new MistralFilterExtractor(config.MISTRAL_API_KEY, config.AI_MODEL)
          : new UnconfiguredFilterExtractor(),
    },
  ],
})
export class AiSearchModule {}
