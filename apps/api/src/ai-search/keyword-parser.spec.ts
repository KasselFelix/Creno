import { aiSearchExtractionSchema } from '@creno/shared';
import { describe, expect, it } from 'vitest';
import { checkWeekday, parseKeywords } from './keyword-parser.js';

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
  timeOfDay: null,
  startAfter: null,
  startBefore: null,
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
      { category: 'hairdresser', place: 'Lyon', startAfter: '18:00', priceMaxEuros: null },
    ],
    [
      'tennis à Marseille ce soir',
      SUNDAY,
      { category: 'sports_field', place: 'Marseille', date: SUNDAY, timeOfDay: 'evening' },
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
      {
        category: 'sports_field',
        startAfter: '14:00',
        startBefore: '16:00',
        ignored: ['pendant 2 heures'],
      },
    ],
    ['max 10 personnes', SUNDAY, { priceMaxEuros: null, ignored: ['10 personnes'] }],
    ['je cherche quelque chose', SUNDAY, NOTHING],
  ])('« %s »', (query, today, expected) => {
    expect(parseKeywords(query, today)).toEqual({ ...NOTHING, ...expected });
  });

  // Lundi 5 octobre 2026, jeudi 8.
  const MONDAY = '2026-10-05';
  it.each([
    // La phrase de l'étape 9 qui a montré le manque : « après midi » était ignoré.
    [
      'un coiffeur sur paris pour lundi après midi',
      { category: 'hairdresser', place: 'paris', date: MONDAY, timeOfDay: 'afternoon' },
    ],
    [
      'coiffeur lundi après-midi',
      { category: 'hairdresser', date: MONDAY, timeOfDay: 'afternoon' },
    ],
    // Exemples de l'accueil : ils doivent marcher aussi sans le modèle.
    [
      'Coiffeur à Paris lundi après-midi',
      { category: 'hairdresser', place: 'Paris', date: MONDAY, timeOfDay: 'afternoon' },
    ],
    [
      'Salle de réunion à Lyon mardi matin',
      { category: 'room', place: 'Lyon', date: '2026-10-06', timeOfDay: 'morning' },
    ],
    [
      'Coiffeur à Lyon jeudi après 18 h',
      { category: 'hairdresser', place: 'Lyon', date: '2026-10-08', startAfter: '18:00' },
    ],
    [
      'coiffeur à Lyon l’après-midi',
      { category: 'hairdresser', place: 'Lyon', timeOfDay: 'afternoon' },
    ],
    ['coiffeur à Lyon en soirée', { category: 'hairdresser', place: 'Lyon', timeOfDay: 'evening' }],
    ['salle à Lyon dans la matinée', { category: 'room', place: 'Lyon', timeOfDay: 'morning' }],
    [
      'coiffeur à Paris après-midi',
      { category: 'hairdresser', place: 'Paris', timeOfDay: 'afternoon' },
    ],
    [
      'terrain jeudi aprem',
      { category: 'sports_field', date: '2026-10-08', timeOfDay: 'afternoon' },
    ],
    [
      'terrain jeudi aprèm',
      { category: 'sports_field', date: '2026-10-08', timeOfDay: 'afternoon' },
    ],
    ['salle demain matin', { category: 'room', date: MONDAY, timeOfDay: 'morning' }],
    ['salle en matinée', { category: 'room', timeOfDay: 'morning' }],
    ['coiffeur ce matin', { category: 'hairdresser', date: SUNDAY, timeOfDay: 'morning' }],
    ['coiffeur cet après-midi', { category: 'hairdresser', date: SUNDAY, timeOfDay: 'afternoon' }],
    ['coiffeur lundi soir', { category: 'hairdresser', date: MONDAY, timeOfDay: 'evening' }],
    // « Une soirée » est un événement, pas une heure.
    ["salle pour une soirée d'anniversaire", { category: 'room' }],
    // « Midi » seul n'est pas une plage : « ce midi » reste aujourd'hui.
    ['coiffeur ce midi', { category: 'hairdresser', date: SUNDAY }],
    ['coiffeur avant 10 h', { category: 'hairdresser', startBefore: '10:00' }],
    [
      'coiffeur jusqu’à 20 h',
      { category: 'hairdresser', startBefore: '20:00', priceMaxEuros: null },
    ],
    [
      'coiffeur à 10 h',
      { category: 'hairdresser', place: null, startAfter: '10:00', startBefore: '11:00' },
    ],
    [
      'coiffeur vers 18h30',
      { category: 'hairdresser', place: null, startAfter: '17:30', startBefore: '19:30' },
    ],
    ['coiffeur vers 0 h', { category: 'hairdresser', startBefore: '01:00', startAfter: '00:00' }],
    ['coiffeur à 23 h', { category: 'hairdresser', startAfter: '23:00', startBefore: '24:00' }],
    ['coiffeur dès 9h', { category: 'hairdresser', startAfter: '09:00' }],
    ['coiffeur à partir de 18:30', { category: 'hairdresser', place: null, startAfter: '18:30' }],
    ['coiffeur après 18 heures', { category: 'hairdresser', startAfter: '18:00' }],
    [
      'terrain samedi 18h-20h',
      { category: 'sports_field', date: SATURDAY, startAfter: '18:00', startBefore: '20:00' },
    ],
    [
      'terrain de 9 h à 12 h 30',
      { category: 'sports_field', startAfter: '09:00', startBefore: '12:30' },
    ],
    [
      'terrain le soir après 20h',
      { category: 'sports_field', timeOfDay: 'evening', startAfter: '20:00' },
    ],
    [
      "coiffeur à Lyon en fin d'après-midi",
      { category: 'hairdresser', place: 'Lyon', timeOfDay: 'afternoon' },
    ],
    ['salle à Lyon en début de soirée', { category: 'room', place: 'Lyon', timeOfDay: 'evening' }],
    ['salle en fin de matinée', { category: 'room', timeOfDay: 'morning' }],
    [
      'coiffeur à Lyon pendant 2h après 18h',
      { category: 'hairdresser', place: 'Lyon', startAfter: '18:00', ignored: ['pendant 2h'] },
    ],
    // Une distance, pas une heure.
    ['terrain à 2 heures de Paris', { category: 'sports_field', ignored: ['2 heures'] }],
    ['coiffeur avant 0 h', { category: 'hairdresser', ignored: ['avant 0 h'] }],
    // Durées et heures seules : pas des plages.
    [
      'terrain samedi pendant 2h',
      { category: 'sports_field', date: SATURDAY, ignored: ['pendant 2h'] },
    ],
    ['terrain pour 2 h', { category: 'sports_field', ignored: ['pour 2 h'] }],
    ['terrain samedi 18h', { category: 'sports_field', date: SATURDAY, ignored: ['18h'] }],
    // Plage impossible : laissée dans les morceaux ignorés.
    ['terrain entre 16 h et 14 h', { category: 'sports_field', ignored: ['entre 16 h et 14 h'] }],
    ['terrain après 25 h', { category: 'sports_field', ignored: ['après 25 h'] }],
  ])('plage horaire : « %s »', (query, expected) => {
    expect(parseKeywords(query, SUNDAY)).toEqual({ ...NOTHING, ...expected });
  });

  it("produit toujours une sortie valide pour le schéma de l'extraction", () => {
    const queries = [
      'coiffeur à Lyon moins de 30 €',
      `salle à ${'Saint-Rémy-de-Provence '.repeat(8)}`,
      '???',
      'terrain le 29/02',
      'terrain entre 16 h et 14 h',
      'coiffeur à 23 h',
      'coiffeur vers 0 h le soir',
    ];
    for (const query of queries) {
      expect(aiSearchExtractionSchema.safeParse(parseKeywords(query, SUNDAY)).success).toBe(true);
    }
  });
});

describe('checkWeekday (date du modèle recoupée avec le jour cité)', () => {
  // Vendredi 16 octobre 2026 : lundi = 19, mardi = 20, vendredi suivant = 23.
  const FRIDAY = '2026-10-16';
  const model = (date: string | null) => ({ ...NOTHING, category: 'hairdresser' as const, date });

  it('jour cité, mauvaise date du modèle → la date calculée', () => {
    const fixed = checkWeekday(model('2026-10-20'), 'un coiffeur pour lundi après-midi', FRIDAY);
    expect(fixed).toEqual(model('2026-10-19'));
  });

  it('date du modèle qui tombe le jour cité → gardée, même plus loin (« vendredi 23 »)', () => {
    expect(checkWeekday(model('2026-10-23'), 'coiffeur vendredi 23', FRIDAY)).toEqual(
      model('2026-10-23'),
    );
  });

  it('aucun jour cité, ou aucune date → sortie du modèle inchangée', () => {
    expect(checkWeekday(model('2026-10-19'), 'coiffeur dans trois jours', FRIDAY)).toEqual(
      model('2026-10-19'),
    );
    expect(checkWeekday(model(null), 'coiffeur lundi', FRIDAY)).toEqual(model(null));
  });
});
