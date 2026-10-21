import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { AI_QUERY_MAX, AI_QUERY_MIN, type InterpretResponse } from '@creno/shared';

/** Versionnée : un autre format plus tard ne relira pas celui-ci de travers. */
export const RECENT_SEARCHES_KEY = 'creno.recent-searches.v1';
const RECENT_SEARCHES_MAX = 3;
const SUGGESTIONS_MAX = 3;

type RecentStorage = Pick<Storage, 'getItem' | 'setItem'>;

const storedSchema = z
  .array(z.string().trim().min(AI_QUERY_MIN).max(AI_QUERY_MAX))
  .max(RECENT_SEARCHES_MAX);

/** Forme de comparaison : casse, accents et espaces ne font pas deux recherches différentes. */
function normalize(query: string): string {
  return query
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Une phrase vaut d'être reproposée si elle cite un filtre qui tient tout seul. Un rayon seul dépend
 * du lieu déjà choisi sur la page (rejoué ailleurs, il ne donne rien) ; une plage sans jour est ignorée.
 */
export function isWorthRemembering(response: InterpretResponse): boolean {
  const { category, place, nearMe, priceMax, date } = response.filters;
  return Boolean(category || place || nearMe || priceMax !== undefined || date);
}

/** La phrase passe en tête, sans doublon, et la liste garde ses 3 plus récentes. */
export function addRecentSearch(list: readonly string[], query: string): string[] {
  return [query, ...removeRecentSearch(list, query)].slice(0, RECENT_SEARCHES_MAX);
}

export function removeRecentSearch(list: readonly string[], query: string): string[] {
  const key = normalize(query);
  return list.filter((item) => normalize(item) !== key);
}

export interface Suggestion {
  text: string;
  /** Recherche du visiteur (sinon : exemple prédéfini). */
  recent: boolean;
}

/**
 * Propositions sous la barre : les recherches récentes, complétées par les exemples. Le champ
 * contient la phrase lancée : on ne la repropose pas, et la rangée reste visible. Pendant la frappe
 * d'une autre phrase, la rangée est masquée sans changer de contenu (rien ne bouge en dessous).
 */
export function visibleSuggestions({
  recent,
  examples,
  query,
  submitted,
}: {
  recent: readonly string[];
  examples: readonly string[];
  query: string;
  submitted: string;
}): { visible: boolean; items: Suggestion[] } {
  const typed = normalize(query);
  const seen = new Set<string>();
  if (typed !== '' && submitted !== '') seen.add(normalize(submitted));

  const items: Suggestion[] = [];
  for (const [texts, isRecent] of [
    [recent, true],
    [examples, false],
  ] as const) {
    for (const text of texts) {
      const key = normalize(text);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ text, recent: isRecent });
    }
  }

  return {
    visible: typed === '' || typed === normalize(submitted),
    items: items.slice(0, SUGGESTIONS_MAX),
  };
}

/** Liste enregistrée, ou `[]` si elle est illisible, d'un autre format ou inaccessible. */
export function readRecentSearches(storage: RecentStorage): string[] {
  try {
    const raw = storage.getItem(RECENT_SEARCHES_KEY);
    if (raw === null) return [];
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    // Contenu modifié à la main : on retire aussi ses doublons (le premier gagne).
    return parsed.success
      ? parsed.data.reduceRight<string[]>((list, query) => addRecentSearch(list, query), [])
      : [];
  } catch {
    return [];
  }
}

/** Échoue en silence (quota plein, stockage bloqué) : les propositions ne sont qu'un confort. */
export function writeRecentSearches(storage: RecentStorage, list: readonly string[]): void {
  try {
    storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // Rien à faire : la liste reste en mémoire pour la session.
  }
}

// Store du navigateur. Le module est aussi évalué côté serveur : `localStorage` n'est lu qu'à la
// première demande d'un composant monté.
let cache: string[] | undefined;
const listeners = new Set<() => void>();

/** `window.localStorage` lui-même peut lever une erreur quand le stockage est bloqué. */
function browserStorage(): RecentStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function load(): string[] {
  const storage = browserStorage();
  return storage ? readRecentSearches(storage) : [];
}

export function getRecentSearches(): string[] {
  cache ??= load();
  return cache;
}

function notify() {
  for (const listener of listeners) listener();
}

/** Un autre onglet a changé la liste (ou vidé le stockage : `key` nul). */
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== RECENT_SEARCHES_KEY) return;
  cache = load();
  notify();
}

export function subscribeRecentSearches(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener('storage', onStorage);
    // Plus personne n'écoute les autres onglets : le cache sera relu au prochain affichage.
    cache = undefined;
  };
}

/** Repart du stockage (un autre onglet a pu l'écrire), sinon de la liste en mémoire. */
function current(): string[] {
  return browserStorage() ? load() : getRecentSearches();
}

function update(next: string[]) {
  cache = next;
  const storage = browserStorage();
  if (storage) writeRecentSearches(storage, next);
  notify();
}

export function saveRecentSearch(query: string): void {
  update(addRecentSearch(current(), query));
}

export function forgetRecentSearch(query: string): void {
  update(removeRecentSearch(current(), query));
}

/** `null` pendant le rendu serveur et l'hydratation : la liste n'est pas encore connue. */
export function useRecentSearches(): string[] | null {
  return useSyncExternalStore(subscribeRecentSearches, getRecentSearches, () => null);
}
