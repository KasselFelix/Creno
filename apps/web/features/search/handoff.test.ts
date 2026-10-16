import { describe, expect, it } from 'vitest';
import type { InterpretResponse } from '@creno/shared';
import { handoffFor, remember } from './handoff';

const response: InterpretResponse = {
  source: 'ai',
  filters: { category: 'hairdresser', date: '2026-10-19', timeFrom: '12:00', timeTo: '18:00' },
  notices: [],
};
const applied = {
  radiusKm: 10,
  category: 'hairdresser' as const,
  date: '2026-10-19',
  timeFrom: '12:00',
  timeTo: '18:00',
};

describe('handoff (accueil → /search)', () => {
  it('rend le relais tant que la page montre les filtres de l’interprétation, sans le consommer', () => {
    remember({ query: 'coiffeur lundi après-midi', response, applied });
    expect(handoffFor({ ...applied })?.query).toBe('coiffeur lundi après-midi');
    // Deuxième lecture (rendu en double, retour sur la même URL) : toujours là.
    expect(handoffFor({ ...applied })?.response).toBe(response);
  });

  it('ne rend rien quand les filtres ont changé', () => {
    remember({ query: 'coiffeur lundi après-midi', response, applied });
    expect(handoffFor({ ...applied, timeFrom: '18:00', timeTo: undefined })).toBeNull();
    expect(handoffFor({ radiusKm: 10 })).toBeNull();
  });

  it('le dernier relais remplace le précédent', () => {
    remember({ query: 'première', response, applied });
    remember({ query: 'seconde', response, applied: { radiusKm: 10 } });
    expect(handoffFor(applied)).toBeNull();
    expect(handoffFor({ radiusKm: 10 })?.query).toBe('seconde');
  });
});
