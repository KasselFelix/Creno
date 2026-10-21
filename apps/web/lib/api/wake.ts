import { useSyncExternalStore } from 'react';

/**
 * Réveil de l'API en veille (0 réplica sans trafic, rendormie environ 6 min après sa dernière
 * requête) : le navigateur la garde éveillée tant que le visiteur est actif, et sait si une attente
 * vient d'un réveil (barre ou écran de chargement) ou d'une API éveillée mais lente (Mistral).
 */

/** Sans réponse de l'API depuis ce délai, elle s'est peut-être rendormie. */
export const STALE_AFTER_MS = 4 * 60_000;
/** Deux pings au plus par minute, quelle que soit l'activité du visiteur. */
export const PING_MIN_INTERVAL_MS = 30_000;
/** Une API éveillée répond en moins d'1 s : au-delà, la barre de chargement s'affiche. */
export const BAR_AFTER_MS = 1_000;
/** L'écran de chargement attend un peu plus, pour ne jamais couvrir une page pour rien. */
export const SCREEN_AFTER_MS = 1_500;
/** Durée d'un réveil complet, pour la barre de progression (mesurée en prod). */
export const WAKE_ESTIMATE_MS = 25_000;

/** Réponses du relais Vercel (API injoignable ou trop lente), pas de l'API elle-même. */
const GATEWAY_ERRORS = new Set([502, 503, 504]);

export interface WakeState {
  /** Dernière réponse de l'API. */
  lastContactAt: number | null;
  /** Début du réveil en cours : premier appel parti alors que l'API ne répondait plus. */
  wakingSince: number | null;
  lastPingAt: number | null;
  /** Requêtes du visiteur en attente (le ping n'en fait pas partie). */
  requests: number;
  pings: number;
  /** Attentes qui justifient l'écran de chargement pendant un réveil (page ouverte, accueil → recherche). */
  pageWaits: number;
  /** Rendus serveur qui traînent (fiche ouverte par un lien) : l'écran sans condition de réveil. */
  serverWaits: number;
}

export type ApiCall = 'ping' | 'request';
export type ScreenHold = 'page' | 'server';

export const initialWakeState: WakeState = {
  lastContactAt: null,
  wakingSince: null,
  lastPingAt: null,
  requests: 0,
  pings: 0,
  pageWaits: 0,
  serverWaits: 0,
};

export function isStale(state: WakeState, now: number): boolean {
  return state.lastContactAt === null || now - state.lastContactAt >= STALE_AFTER_MS;
}

export function shouldPing(state: WakeState, now: number): boolean {
  return (
    isStale(state, now) &&
    state.pings === 0 &&
    (state.lastPingAt === null || now - state.lastPingAt >= PING_MIN_INTERVAL_MS)
  );
}

export function callStarted(state: WakeState, call: ApiCall, now: number): WakeState {
  const wakingSince = state.wakingSince ?? (isStale(state, now) ? now : null);
  return call === 'ping'
    ? { ...state, wakingSince, lastPingAt: now, pings: state.pings + 1 }
    : { ...state, wakingSince, requests: state.requests + 1 };
}

/** `status` : code HTTP reçu, `undefined` si la requête a échoué (réseau, abandon). */
export function callEnded(
  state: WakeState,
  call: ApiCall,
  status: number | undefined,
  now: number,
): WakeState {
  const next =
    call === 'ping'
      ? { ...state, pings: state.pings - 1 }
      : { ...state, requests: state.requests - 1 };
  if (status !== undefined && !GATEWAY_ERRORS.has(status)) {
    return { ...next, lastContactAt: now, wakingSince: null };
  }
  // Sans réponse de l'API et plus rien en cours : le prochain appel recommencera le réveil.
  return next.requests + next.pings === 0 ? { ...next, wakingSince: null } : next;
}

/** L'API ne répond plus depuis 4 min et le réveil en cours dure depuis au moins `after` ms. */
function wakingFor(state: WakeState, now: number, after: number): boolean {
  return state.wakingSince !== null && isStale(state, now) && now - state.wakingSince >= after;
}

/** Le visiteur attend une réponse pendant un réveil : la barre de chargement s'affiche. */
export function isWaking(state: WakeState, now: number): boolean {
  return state.requests > 0 && wakingFor(state, now, BAR_AFTER_MS);
}

/** Une page attend l'API qui se réveille (ou un rendu serveur traîne) : l'écran de chargement. */
export function wantsScreen(state: WakeState, now: number): boolean {
  return state.serverWaits > 0 || (state.pageWaits > 0 && wakingFor(state, now, SCREEN_AFTER_MS));
}

/** Avancement estimé du réveil (0-95 %) : jamais 100 % avant la réponse. */
export function wakeProgress(since: number, now: number): number {
  return Math.min(95, Math.max(0, ((now - since) / WAKE_ESTIMATE_MS) * 100));
}

// Mémoire partagée du navigateur : un état par onglet, lu par `useApiWake`.
let state = initialWakeState;
const listeners = new Set<() => void>();

function update(next: WakeState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Suit un appel à l'API ; la fonction renvoyée se rappelle avec le code HTTP reçu. */
export function trackApiCall(call: ApiCall): (status: number | undefined) => void {
  update(callStarted(state, call, Date.now()));
  return (status) => update(callEnded(state, call, status, Date.now()));
}

/** Déclare une attente qui justifie l'écran de chargement ; la fonction renvoyée la lève. */
export function holdScreen(kind: ScreenHold): () => void {
  const key = kind === 'page' ? 'pageWaits' : 'serverWaits';
  update({ ...state, [key]: state[key] + 1 });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    update({ ...state, [key]: state[key] - 1 });
  };
}

/** Réveille l'API si elle ne répond plus depuis 4 min (sans attendre la réponse). */
export function pingApi() {
  if (!shouldPing(state, Date.now())) return;
  const ended = trackApiCall('ping');
  fetch('/api/health', { cache: 'no-store' }).then(
    (res) => ended(res.status),
    () => ended(undefined),
  );
}

export function getApiWakeState(): WakeState {
  return state;
}

export function useApiWake(): WakeState {
  return useSyncExternalStore(subscribe, getApiWakeState, () => initialWakeState);
}
