import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from '../common/clock.js';
import type { AppConfig } from '../config/env.js';
import type { Geocoder } from '../geocoding/geocoder.js';
import type { AiRequestsRepository } from './ai-requests.repository.js';
import { AiSearchService } from './ai-search.service.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { type FilterExtractor, UnconfiguredFilterExtractor } from './filter-extractor.js';

// Les tests e2e tournent avec NODE_ENV=test : le démarrage en production se teste sur le service seul.
function startService(nodeEnv: AppConfig['NODE_ENV'], extractor: FilterExtractor) {
  const service = new AiSearchService(
    extractor,
    { search: vi.fn<Geocoder['search']>() },
    { NODE_ENV: nodeEnv } as AppConfig,
    systemClock,
    new CircuitBreaker(systemClock),
    {} as AiRequestsRepository,
  );
  service.onModuleInit();
}

describe('AiSearchService au démarrage', () => {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  afterEach(() => warn.mockClear());

  it('signale en production une clé absente : la recherche ne marchera que par mots-clés', () => {
    startService('production', new UnconfiguredFilterExtractor());
    expect(warn).toHaveBeenCalledWith({ event: 'ai.not_configured' });
  });

  it('se tait en développement, et en production quand la clé est là', () => {
    startService('development', new UnconfiguredFilterExtractor());
    startService('production', { configured: true, extract: vi.fn<FilterExtractor['extract']>() });
    expect(warn).not.toHaveBeenCalled();
  });
});
