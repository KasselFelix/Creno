import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InterpretResponse } from '@creno/shared';
import {
  addRecentSearch,
  getRecentSearches,
  saveRecentSearch,
  subscribeRecentSearches,
  isWorthRemembering,
  readRecentSearches,
  RECENT_SEARCHES_KEY,
  removeRecentSearch,
  visibleSuggestions,
  writeRecentSearches,
} from './recent-searches';

const response = (filters: InterpretResponse['filters']): InterpretResponse => ({
  source: 'ai',
  filters,
  notices: [],
});

/** Faux `localStorage` en mémoire. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const blockedStorage = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('isWorthRemembering', () => {
  it('garde une phrase qui cite un filtre tenant tout seul', () => {
    expect(isWorthRemembering(response({ category: 'hairdresser' }))).toBe(true);
    expect(isWorthRemembering(response({ place: { label: 'Lyon', lat: 45.76, lng: 4.83 } }))).toBe(
      true,
    );
    expect(isWorthRemembering(response({ nearMe: true }))).toBe(true);
    expect(isWorthRemembering(response({ priceMax: 3000 }))).toBe(true);
    expect(isWorthRemembering(response({ date: '2026-10-24' }))).toBe(true);
  });

  it("oublie une phrase sans filtre, ou qui ne cite qu'un rayon ou une plage sans jour", () => {
    expect(isWorthRemembering(response({}))).toBe(false);
    expect(isWorthRemembering(response({ radiusKm: 25 }))).toBe(false);
    expect(isWorthRemembering(response({ timeFrom: '18:00' }))).toBe(false);
  });
});

describe('addRecentSearch', () => {
  it('met la phrase en tête et garde les 3 plus récentes', () => {
    expect(
      addRecentSearch(
        ['b', 'c', 'd'].map((x) => `${x} à Lyon`),
        'a à Lyon',
      ),
    ).toEqual(['a à Lyon', 'b à Lyon', 'c à Lyon']);
  });

  it('fusionne les doublons (casse, accents, espaces) sous la dernière forme tapée', () => {
    expect(addRecentSearch(['Salle à Lyon', 'Coiffeur à Paris'], 'coiffeur  a paris')).toEqual([
      'coiffeur  a paris',
      'Salle à Lyon',
    ]);
  });
});

describe('removeRecentSearch', () => {
  it('retire la phrase sous toutes ses formes et garde les autres dans l’ordre', () => {
    expect(
      removeRecentSearch(['Salle à Lyon', 'Coiffeur à Paris', 'Foot'], 'COIFFEUR A PARIS'),
    ).toEqual(['Salle à Lyon', 'Foot']);
  });
});

describe('visibleSuggestions', () => {
  const examples = ['Exemple 1', 'Exemple 2', 'Exemple 3'];

  it('complète les recherches récentes par les exemples, 3 au total, sans doublon', () => {
    const { visible, items } = visibleSuggestions({
      recent: ['Coiffeur à Paris', 'exemple 2'],
      examples,
      query: '',
      submitted: '',
    });
    expect(visible).toBe(true);
    expect(items).toEqual([
      { text: 'Coiffeur à Paris', recent: true },
      { text: 'exemple 2', recent: true },
      { text: 'Exemple 1', recent: false },
    ]);
  });

  it('reste visible sous la phrase lancée, sans la reproposer', () => {
    const { visible, items } = visibleSuggestions({
      recent: ['Coiffeur à Paris', 'Salle à Lyon'],
      examples,
      query: 'Coiffeur à Paris',
      submitted: 'Coiffeur à Paris',
    });
    expect(visible).toBe(true);
    expect(items.map((item) => item.text)).toEqual(['Salle à Lyon', 'Exemple 1', 'Exemple 2']);
  });

  it('se masque pendant la frappe d’une autre phrase, sans changer de contenu', () => {
    const base = {
      recent: ['Coiffeur à Paris', 'Salle à Lyon'],
      examples,
      submitted: 'Coiffeur à Paris',
    };
    const shown = visibleSuggestions({ ...base, query: 'Coiffeur à Paris' });
    const typing = visibleSuggestions({ ...base, query: 'Coiffeur à Pa' });
    expect(typing.visible).toBe(false);
    expect(typing.items).toEqual(shown.items);
  });

  it('champ vidé : la phrase lancée est reproposée', () => {
    const { visible, items } = visibleSuggestions({
      recent: ['Coiffeur à Paris'],
      examples,
      query: '',
      submitted: 'Coiffeur à Paris',
    });
    expect(visible).toBe(true);
    expect(items[0]).toEqual({ text: 'Coiffeur à Paris', recent: true });
  });
});

describe('readRecentSearches / writeRecentSearches', () => {
  it('relit ce qui a été écrit', () => {
    const storage = memoryStorage();
    writeRecentSearches(storage, ['Coiffeur à Paris']);
    expect(storage.data.get(RECENT_SEARCHES_KEY)).toBe('["Coiffeur à Paris"]');
    expect(readRecentSearches(storage)).toEqual(['Coiffeur à Paris']);
  });

  it('retire les doublons d’un contenu modifié à la main', () => {
    const storage = memoryStorage({
      [RECENT_SEARCHES_KEY]: JSON.stringify(['Coiffeur à Paris', 'coiffeur a paris']),
    });
    expect(readRecentSearches(storage)).toEqual(['Coiffeur à Paris']);
  });

  it('ignore un contenu absent, illisible ou d’un autre format', () => {
    const tooLong = 'a'.repeat(5000);
    for (const raw of [
      undefined,
      '{pas du json',
      '{"x":1}',
      '[1, 2]',
      JSON.stringify([tooLong]),
      JSON.stringify(['un', 'deux', 'trois', 'quatre'].map((x) => `${x} essai`)),
    ]) {
      const storage = memoryStorage(raw === undefined ? {} : { [RECENT_SEARCHES_KEY]: raw });
      expect(readRecentSearches(storage)).toEqual([]);
    }
  });

  it('ne lève jamais d’erreur quand le stockage est bloqué', () => {
    expect(readRecentSearches(blockedStorage)).toEqual([]);
    expect(() => writeRecentSearches(blockedStorage, ['Coiffeur à Paris'])).not.toThrow();
  });
});

describe('store du navigateur', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubWindow() {
    const storage = memoryStorage();
    vi.stubGlobal('window', {
      localStorage: storage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    return storage;
  }

  it('relit le stockage après une page sans barre de recherche (autre onglet entre-temps)', () => {
    const storage = stubWindow();
    const unsubscribe = subscribeRecentSearches(() => {});
    saveRecentSearch('Coiffeur à Paris');
    unsubscribe();
    // Un autre onglet enregistre une recherche pendant que celui-ci n'affiche pas de barre.
    storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['Salle à Lyon', 'Coiffeur à Paris']));
    subscribeRecentSearches(() => {});
    expect(getRecentSearches()).toEqual(['Salle à Lyon', 'Coiffeur à Paris']);
  });

  it('une recherche part du stockage et n’écrase pas celle d’un autre onglet', () => {
    const storage = stubWindow();
    subscribeRecentSearches(() => {});
    saveRecentSearch('Coiffeur à Paris');
    storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['Salle à Lyon', 'Coiffeur à Paris']));
    saveRecentSearch('Photographe à Bordeaux');
    expect(readRecentSearches(storage)).toEqual([
      'Photographe à Bordeaux',
      'Salle à Lyon',
      'Coiffeur à Paris',
    ]);
  });

  it('garde un instantané stable tant que rien ne change', () => {
    stubWindow();
    subscribeRecentSearches(() => {});
    expect(getRecentSearches()).toBe(getRecentSearches());
  });
});
