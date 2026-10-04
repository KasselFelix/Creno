import { aiSearchExtractionSchema } from '@creno/shared';
import { describe, expect, it } from 'vitest';
import { parseKeywords } from './keyword-parser.js';

// Dimanche 4 octobre 2026 ; le samedi suivant est le 10.
const SUNDAY = '2026-10-04';
const SATURDAY = '2026-10-10';

const NOTHING = {
  category: null,
  place: null,
  nearMe: false,
  radiusKm: null,
  priceMaxEuros: null,
  date: null,
  ignored: [],
};

describe('parseKeywords', () => {
  it.each([
    [
      'coiffeur à Lyon moins de 30 €',
      SUNDAY,
      { category: 'hairdresser', place: 'Lyon', priceMaxEuros: 30 },
    ],
    [
      'terrain de foot à Bordeaux samedi moins de 40 €',
      SUNDAY,
      { category: 'sports_field', place: 'Bordeaux', date: SATURDAY, priceMaxEuros: 40 },
    ],
    // Un samedi, « samedi » désigne aujourd'hui.
    ['terrain samedi', SATURDAY, { category: 'sports_field', date: SATURDAY }],
    ['coiffeur à domicile', SUNDAY, { category: 'hairdresser', place: null }],
    ['terrain à 30 €', SUNDAY, { category: 'sports_field', place: null, priceMaxEuros: 30 }],
    [
      'photographe à partir de 50 €',
      SUNDAY,
      { category: 'photographer', place: null, priceMaxEuros: null },
    ],
    ['salle de réunion près de moi', SUNDAY, { category: 'room', nearMe: true, place: null }],
    [
      'padel autour de chez moi ce week-end',
      SUNDAY,
      { category: 'sports_field', nearMe: true, place: null, date: SATURDAY },
    ],
    [
      'Barbier à Évry demain',
      SUNDAY,
      { category: 'hairdresser', place: 'Évry', date: '2026-10-05' },
    ],
    [
      'tennis à Paris dans un rayon de 5 km',
      SUNDAY,
      { category: 'sports_field', place: 'Paris', radiusKm: 5 },
    ],
    [
      'padel à moins de 5 km',
      SUNDAY,
      { category: 'sports_field', place: null, radiusKm: 5, priceMaxEuros: null },
    ],
    [
      'studio photo sur Lille après-demain',
      SUNDAY,
      { category: 'photographer', place: 'Lille', date: '2026-10-06' },
    ],
    [
      'salle pour 10 personnes à Nantes le 12/10',
      SUNDAY,
      {
        category: 'room',
        place: 'Nantes',
        date: '2026-10-12',
        priceMaxEuros: null,
        ignored: ['pour 10 personnes'],
      },
    ],
    ['coiffure le 31/02', SUNDAY, { category: 'hairdresser', date: null }],
    // Le 3 octobre est passé : c'est celui de l'an prochain (le service le signalera hors plage).
    ['shooting le 03/10', SUNDAY, { category: 'photographer', date: '2027-10-03' }],
    ['terrain de five max 45,50 euros', SUNDAY, { category: 'sports_field', priceMaxEuros: 45.5 }],
    ['coiffeur ≤ 25', SUNDAY, { category: 'hairdresser', priceMaxEuros: 25 }],
    [
      'barbier à Lyon après 18 h',
      SUNDAY,
      { category: 'hairdresser', place: 'Lyon', ignored: ['après 18 h'], priceMaxEuros: null },
    ],
    [
      'tennis à Marseille ce soir',
      SUNDAY,
      { category: 'sports_field', place: 'Marseille', date: SUNDAY },
    ],
    [
      'photographe le 1er novembre à Toulouse',
      SUNDAY,
      { category: 'photographer', place: 'Toulouse', date: '2026-11-01' },
    ],
    ['COIFFEUR À LYON', SUNDAY, { category: 'hairdresser', place: 'LYON' }],
    ['salle de séminaire à Saint-Étienne', SUNDAY, { category: 'room', place: 'Saint-Étienne' }],
    ['coiffeur aujourd’hui', SUNDAY, { category: 'hairdresser', date: SUNDAY }],
    [
      'studio photo vers 12 rue Oberkampf Paris',
      SUNDAY,
      { category: 'photographer', place: '12 rue Oberkampf Paris' },
    ],
    ['salle à la Défense', SUNDAY, { category: 'room', place: 'la Défense' }],
    [
      'terrain entre 14h et 16h pendant 2 heures',
      SUNDAY,
      { category: 'sports_field', ignored: ['entre 14h et 16h', 'pendant 2 heures'] },
    ],
    ['max 10 personnes', SUNDAY, { priceMaxEuros: null, ignored: ['10 personnes'] }],
    ['je cherche quelque chose', SUNDAY, NOTHING],
  ])('« %s »', (query, today, expected) => {
    expect(parseKeywords(query, today)).toEqual({ ...NOTHING, ...expected });
  });

  it("produit toujours une sortie valide pour le schéma de l'extraction", () => {
    const queries = [
      'coiffeur à Lyon moins de 30 €',
      `salle à ${'Saint-Rémy-de-Provence '.repeat(8)}`,
      '???',
      'terrain le 29/02',
    ];
    for (const query of queries) {
      expect(aiSearchExtractionSchema.safeParse(parseKeywords(query, SUNDAY)).success).toBe(true);
    }
  });
});
