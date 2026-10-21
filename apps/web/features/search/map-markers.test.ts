import { describe, expect, it } from 'vitest';
import { keepIfListed, markerLayer } from './map-markers';

describe('markerLayer', () => {
  it('la pastille survolée passe devant la sélectionnée, qui passe devant les autres', () => {
    const state = { activeId: 'a', selectedId: 'b' };
    expect(markerLayer('a', state)).toEqual({ active: true, zIndex: 2 });
    expect(markerLayer('b', state)).toEqual({ active: true, zIndex: 1 });
    expect(markerLayer('c', state)).toEqual({ active: false, zIndex: 0 });
  });

  it('une pastille survolée et sélectionnée reste au premier plan', () => {
    expect(markerLayer('a', { activeId: 'a', selectedId: 'a' })).toEqual({
      active: true,
      zIndex: 2,
    });
  });

  it('sans survol ni sélection, toutes les pastilles sont au repos', () => {
    expect(markerLayer('a', { activeId: null, selectedId: null })).toEqual({
      active: false,
      zIndex: 0,
    });
  });
});

describe('keepIfListed', () => {
  const items = [{ id: 'a' }, { id: 'b' }];

  it('garde un prestataire encore présent dans les résultats', () => {
    expect(keepIfListed('a', items)).toBe('a');
  });

  it('oublie un prestataire absent des nouveaux résultats', () => {
    expect(keepIfListed('z', items)).toBeNull();
    expect(keepIfListed(null, items)).toBeNull();
  });
});
