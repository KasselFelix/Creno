import { describe, expect, it } from 'vitest';
import {
  callEnded,
  callStarted,
  initialWakeState,
  isWaking,
  PING_MIN_INTERVAL_MS,
  shouldPing,
  STALE_AFTER_MS,
  type WakeState,
  WAKE_ESTIMATE_MS,
  WAKING_NOTICE_AFTER_MS,
  wakeProgress,
} from './wake';

const awakeAt = (at: number): WakeState => ({ ...initialWakeState, lastContactAt: at });

describe('shouldPing', () => {
  it("pinge au chargement : l'API n'a encore jamais répondu", () => {
    expect(shouldPing(initialWakeState, 0)).toBe(true);
  });

  it('ne pinge pas une API qui a répondu il y a moins de 4 min', () => {
    expect(shouldPing(awakeAt(0), STALE_AFTER_MS - 1)).toBe(false);
    expect(shouldPing(awakeAt(0), STALE_AFTER_MS)).toBe(true);
  });

  it('un seul ping en cours, et au plus un toutes les 30 s', () => {
    const pinging = callStarted(initialWakeState, 'ping', 0);
    expect(shouldPing(pinging, 1_000)).toBe(false);
    const failed = callEnded(pinging, 'ping', undefined, 1_000);
    expect(shouldPing(failed, PING_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(shouldPing(failed, PING_MIN_INTERVAL_MS)).toBe(true);
  });
});

describe('callStarted / callEnded', () => {
  it("une réponse de l'API termine le réveil", () => {
    const pinging = callStarted(initialWakeState, 'ping', 0);
    expect(pinging.wakingSince).toBe(0);
    const awake = callEnded(pinging, 'ping', 200, 22_000);
    expect(awake).toMatchObject({ lastContactAt: 22_000, wakingSince: null, pings: 0 });
  });

  it("une erreur de l'API (4xx, 500) prouve aussi qu'elle est éveillée", () => {
    const requesting = callStarted(initialWakeState, 'request', 0);
    expect(callEnded(requesting, 'request', 429, 100).lastContactAt).toBe(100);
  });

  it('une erreur du relais (502, 504) ou du réseau ne compte pas comme une réponse', () => {
    const both = callStarted(callStarted(initialWakeState, 'ping', 0), 'request', 5_000);
    const gateway = callEnded(both, 'request', 504, 6_000);
    expect(gateway).toMatchObject({ lastContactAt: null, wakingSince: 0, requests: 0 });
    // Plus rien en cours : le prochain appel recommencera le réveil.
    expect(callEnded(gateway, 'ping', undefined, 7_000).wakingSince).toBeNull();
  });

  it('le réveil part du premier appel, pas de la requête du visiteur', () => {
    const pinging = callStarted(initialWakeState, 'ping', 0);
    expect(callStarted(pinging, 'request', 10_000).wakingSince).toBe(0);
  });

  it("pas de réveil quand l'API a répondu récemment", () => {
    expect(callStarted(awakeAt(0), 'request', 60_000).wakingSince).toBeNull();
  });
});

describe('isWaking', () => {
  it("affiche l'avis quand le visiteur attend pendant un réveil de plus de 2 s", () => {
    const pinging = callStarted(initialWakeState, 'ping', 0);
    const waiting = callStarted(pinging, 'request', 1_000);
    expect(isWaking(waiting, WAKING_NOTICE_AFTER_MS - 1)).toBe(false);
    expect(isWaking(waiting, WAKING_NOTICE_AFTER_MS)).toBe(true);
    // Le visiteur cherche 10 s après son arrivée : l'avis s'affiche tout de suite.
    expect(isWaking(callStarted(pinging, 'request', 10_000), 10_000)).toBe(true);
  });

  it("pas d'avis pendant un simple ping (le visiteur lit, il n'attend rien)", () => {
    expect(isWaking(callStarted(initialWakeState, 'ping', 0), 10_000)).toBe(false);
  });

  it("pas d'avis sur une API éveillée mais lente (Mistral)", () => {
    const slow = callStarted(awakeAt(0), 'request', 1_000);
    expect(isWaking(slow, 9_000)).toBe(false);
  });

  it("l'avis disparaît à la première réponse", () => {
    const waiting = callStarted(callStarted(initialWakeState, 'ping', 0), 'request', 0);
    const answered = callEnded(waiting, 'ping', 200, 20_000);
    expect(isWaking(answered, 20_000)).toBe(false);
  });
});

describe('wakeProgress', () => {
  it('avance avec le temps sans jamais atteindre 100 %', () => {
    expect(wakeProgress(0, 0)).toBe(0);
    expect(wakeProgress(0, WAKE_ESTIMATE_MS * 0.4)).toBeCloseTo(40);
    expect(wakeProgress(0, WAKE_ESTIMATE_MS * 3)).toBe(95);
    expect(wakeProgress(1_000, 0)).toBe(0);
  });
});
