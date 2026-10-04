import { describe, expect, it } from 'vitest';
import { FilterExtractorError } from './filter-extractor.js';
import { retryDelayMs, withTimeout } from './with-retry.js';

describe('retryDelayMs', () => {
  it.each(['timeout', 'network', 'server_error'] as const)(
    '%s → reprise après 250 à 500 ms',
    (reason) => {
      expect(retryDelayMs(reason, undefined, () => 0)).toBe(250);
      expect(retryDelayMs(reason, undefined, () => 0.999)).toBe(500);
    },
  );

  it('429 → au moins 1 s, ou le délai demandé par le fournisseur', () => {
    expect(retryDelayMs('rate_limited', undefined)).toBe(1000);
    expect(retryDelayMs('rate_limited', 200)).toBe(1000);
    expect(retryDelayMs('rate_limited', 2000)).toBe(2000);
  });

  it.each(['bad_request', 'unauthorized', 'invalid_output', 'not_configured'] as const)(
    '%s → pas de reprise',
    (reason) => {
      expect(retryDelayMs(reason, undefined)).toBeNull();
    },
  );
});

describe('withTimeout', () => {
  it('renvoie le résultat dans les temps', async () => {
    await expect(withTimeout(() => Promise.resolve('ok'), 100)).resolves.toBe('ok');
  });

  it('coupe un appel qui ignore le signal, et interrompt le signal', async () => {
    let received: AbortSignal | undefined;
    const never = (signal: AbortSignal) => {
      received = signal;
      return new Promise<never>(() => {});
    };
    await expect(withTimeout(never, 20)).rejects.toEqual(new FilterExtractorError('timeout'));
    expect(received?.aborted).toBe(true);
  });
});
