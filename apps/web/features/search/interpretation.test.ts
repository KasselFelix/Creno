import { describe, expect, it } from 'vitest';
import type { InterpretResponse } from '@creno/shared';
import { formatPrice } from '@/lib/format';
import {
  applyInterpretation,
  interpretationMatches,
  interpretationNotices,
  understoodFilters,
} from './interpretation';
import { parseSearchParams, type SearchFilters, toSearchParams } from './params';

const response = (
  filters: InterpretResponse['filters'],
  extra: Partial<InterpretResponse> = {},
): InterpretResponse => ({ source: 'ai', filters, notices: [], ...extra });

const LYON = { label: 'Lyon', lat: 45.764, lng: 4.836 };
const BORDEAUX: SearchFilters = {
  center: { lat: 44.838, lng: -0.579 },
  place: 'Bordeaux',
  radiusKm: 25,
  category: 'room',
  priceMax: 5000,
  date: '2026-10-12',
};

describe('applyInterpretation', () => {
  it('garde le lieu actuel si la phrase n’en cite pas, et remet le reste à zéro', () => {
    expect(applyInterpretation(BORDEAUX, response({ category: 'hairdresser' }))).toEqual({
      filters: {
        center: BORDEAUX.center,
        place: 'Bordeaux',
        radiusKm: 10,
        category: 'hairdresser',
        priceMax: undefined,
        date: undefined,
      },
      nearMe: false,
    });
  });

  it('remplace le lieu par celui de la phrase et applique tous ses filtres', () => {
    const { filters, nearMe } = applyInterpretation(
      BORDEAUX,
      response({
        category: 'hairdresser',
        place: LYON,
        radiusKm: 5,
        priceMax: 3000,
        date: '2026-10-10',
      }),
    );
    expect(filters).toEqual({
      center: { lat: LYON.lat, lng: LYON.lng },
      place: 'Lyon',
      radiusKm: 5,
      category: 'hairdresser',
      priceMax: 3000,
      date: '2026-10-10',
    });
    expect(nearMe).toBe(false);
  });

  it('ignore un rayon sans centre', () => {
    const { filters } = applyInterpretation({ radiusKm: 10 }, response({ radiusKm: 5 }));
    expect(filters).toMatchObject({ center: undefined, radiusKm: 10 });
  });

  it('« près de moi » demande la géolocalisation et garde le rayon cité', () => {
    const { filters, nearMe } = applyInterpretation(
      { radiusKm: 10 },
      response({ nearMe: true, radiusKm: 2, category: 'sports_field' }),
    );
    expect(nearMe).toBe(true);
    expect(filters).toMatchObject({ radiusKm: 2, category: 'sports_field' });
  });

  it('une phrase sans filtre reconnu relance une recherche sans filtre autour du lieu actuel', () => {
    expect(applyInterpretation(BORDEAUX, response({})).filters).toEqual({
      center: BORDEAUX.center,
      place: 'Bordeaux',
      radiusKm: 10,
    });
  });
});

describe('interpretationMatches : visibilité de la ligne « Compris »', () => {
  const applied = applyInterpretation(
    BORDEAUX,
    response({ category: 'hairdresser', place: LYON, date: '2026-10-10' }),
  ).filters;
  const fromUrl = parseSearchParams(toSearchParams(applied), '2026-10-04');

  it('visible tant que l’URL porte les filtres de l’interprétation', () => {
    expect(interpretationMatches(fromUrl, applied)).toBe(true);
  });

  it('masquée après une modification à la main ou un retour arrière', () => {
    expect(interpretationMatches({ ...fromUrl, priceMax: 2000 }, applied)).toBe(false);
    expect(interpretationMatches({ ...fromUrl, date: undefined }, applied)).toBe(false);
    expect(interpretationMatches(BORDEAUX, applied)).toBe(false);
  });
});

describe('understoodFilters', () => {
  it('liste les filtres compris, tels qu’appliqués', () => {
    const cited = response({
      category: 'hairdresser',
      place: LYON,
      radiusKm: 5,
      priceMax: 3000,
      date: '2026-10-10',
    });
    const { filters } = applyInterpretation({ radiusKm: 10 }, cited);
    expect(understoodFilters(cited, filters)).toEqual([
      'Coiffeur',
      'Lyon',
      '5 km',
      `${formatPrice(3000, 'EUR')} max`,
      'samedi 10 octobre',
    ]);
  });

  it('« Autour de moi » pour la position, et pas de rayon resté sans centre', () => {
    const near = response({ nearMe: true, radiusKm: 2 });
    // Géolocalisation refusée, aucun lieu actuel : le rayon n'a pas été appliqué.
    expect(understoodFilters(near, { radiusKm: 10 })).toEqual(['Autour de moi']);
    expect(understoodFilters(near, { radiusKm: 2, center: { lat: 1, lng: 2 } })).toEqual([
      'Autour de moi',
      '2 km',
    ]);
  });
});

describe('interpretationNotices', () => {
  it('dit ce qui n’a pas été pris en compte', () => {
    expect(
      interpretationNotices(
        response(
          {},
          {
            notices: [
              { type: 'place_not_found', place: 'Bordo' },
              { type: 'date_out_of_range', date: '2027-02-12' },
              { type: 'ignored_terms', terms: ['après 18 h'] },
              { type: 'ignored_terms', terms: ['après 18 h', 'pour 10 personnes'] },
            ],
          },
        ),
      ),
    ).toEqual([
      'Lieu « Bordo » introuvable.',
      "Le vendredi 12 février n'est pas réservable (d'aujourd'hui à 90 jours).",
      "« après 18 h » n'est pas pris en compte.",
      '« après 18 h », « pour 10 personnes » ne sont pas pris en compte.',
    ]);
  });

  it('signale la recherche par mots-clés en premier', () => {
    expect(
      interpretationNotices(
        response(
          {},
          { source: 'keywords', notices: [{ type: 'place_not_found', place: 'Bordo' }] },
        ),
      ),
    ).toEqual([
      'Recherche simplifiée par mots-clés (assistant indisponible).',
      'Lieu « Bordo » introuvable.',
    ]);
  });
});
