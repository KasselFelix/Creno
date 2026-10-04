import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../common/clock.js';
import { CircuitBreaker } from './circuit-breaker.js';

/** Horloge arrêtée qu'on avance à la main. */
function manualClock() {
  let now = 1_800_000_000_000;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance(ms: number) {
      now += ms;
    },
  } satisfies Clock & { advance(ms: number): void };
}

describe('CircuitBreaker', () => {
  let clock: ReturnType<typeof manualClock>;
  let breaker: CircuitBreaker;

  const fail = (times: number) => {
    let opened = false;
    for (let i = 0; i < times; i++) {
      expect(breaker.acquire()).toBe(true);
      opened = breaker.recordFailure();
    }
    return opened;
  };

  beforeEach(() => {
    clock = manualClock();
    breaker = new CircuitBreaker(clock, { failureThreshold: 5, openMs: 30_000 });
  });

  it("s'ouvre au 5e échec consécutif, pas avant", () => {
    expect(fail(4)).toBe(false);
    expect(breaker.canAttempt()).toBe(true);
    expect(fail(1)).toBe(true);
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.acquire()).toBe(false);
  });

  it('un succès, ou une sortie invalide (le modèle répond), remet le compte à zéro', () => {
    fail(4);
    breaker.acquire();
    expect(breaker.recordSuccess()).toBe(false);
    expect(fail(4)).toBe(false);
    expect(breaker.canAttempt()).toBe(true);
  });

  it('reste ouvert 30 s, puis laisse passer un seul essai', () => {
    fail(5);
    clock.advance(29_999);
    expect(breaker.acquire()).toBe(false);
    clock.advance(1);
    expect(breaker.acquire()).toBe(true);
    // Pendant l'essai, les autres requêtes passent par les mots-clés.
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.acquire()).toBe(false);
  });

  it('essai réussi → fermé', () => {
    fail(5);
    clock.advance(30_000);
    breaker.acquire();
    expect(breaker.recordSuccess()).toBe(true);
    expect(breaker.canAttempt()).toBe(true);
    expect(fail(4)).toBe(false);
  });

  it('essai raté → rouvert pour 30 s', () => {
    fail(5);
    clock.advance(30_000);
    breaker.acquire();
    expect(breaker.recordFailure()).toBe(true);
    clock.advance(29_999);
    expect(breaker.canAttempt()).toBe(false);
    clock.advance(1);
    expect(breaker.canAttempt()).toBe(true);
  });

  it("essai sans verdict (requête refusée) → l'essai est libéré pour la requête suivante", () => {
    fail(5);
    clock.advance(30_000);
    breaker.acquire();
    breaker.recordNeutral();
    expect(breaker.acquire()).toBe(true);
  });
});
