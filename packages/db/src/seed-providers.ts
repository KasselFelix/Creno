// Prestataires de démo pour la recherche géographique : assez nombreux, autour de trois villes,
// pour que le rayon, le tri par distance et les filtres se voient. Coordonnées approximatives.
import type { providers } from './schema/index.js';

type Category = (typeof providers.$inferInsert)['category'];

export interface ResourceSeed {
  name: string;
  slotMinutes: number;
  priceCents: number;
  isActive?: boolean;
}

export interface ProviderSeed {
  email: string;
  fullName: string;
  name: string;
  slug: string;
  category: Category;
  address: string;
  city: string;
  /** Attention à l'ordre des deux coordonnées dans PostGIS : longitude, puis latitude. */
  lng: number;
  lat: number;
  resources: ResourceSeed[];
}

type Row = [
  slug: string,
  name: string,
  category: Category,
  address: string,
  city: string,
  lng: number,
  lat: number,
  resources: ResourceSeed[],
];

const one = (name: string, slotMinutes: number, priceCents: number): ResourceSeed => ({
  name,
  slotMinutes,
  priceCents,
});

const rows: Row[] = [
  // Paris et petite couronne
  [
    'coiffure-bastille',
    'Coiffure Bastille',
    'hairdresser',
    '8 rue de la Roquette',
    'Paris',
    2.3712,
    48.8537,
    [one('Coupe', 30, 3200), one('Brushing', 30, 2200)],
  ],
  [
    'salon-des-abbesses',
    'Salon des Abbesses',
    'hairdresser',
    '21 rue des Abbesses',
    'Paris',
    2.337,
    48.8845,
    [one('Coupe', 30, 2800), one('Coupe + couleur', 90, 8500)],
  ],
  [
    'barbier-de-montreuil',
    'Barbier de Montreuil',
    'hairdresser',
    '30 rue de Paris',
    'Montreuil',
    2.441,
    48.861,
    [one('Coupe + barbe', 30, 2000)],
  ],
  [
    'foot-indoor-ivry',
    'Foot Indoor Ivry',
    'sports_field',
    '12 quai Marcel Boyer',
    'Ivry-sur-Seine',
    2.3905,
    48.8205,
    [one('Terrain A (5 contre 5)', 60, 8000), one('Terrain B (5 contre 5)', 60, 8000)],
  ],
  [
    'tennis-de-vincennes',
    'Tennis de Vincennes',
    'sports_field',
    '5 avenue de Nogent',
    'Vincennes',
    2.439,
    48.842,
    [one('Court couvert', 60, 2200)],
  ],
  [
    'salle-du-marais',
    'Salle du Marais',
    'room',
    '14 rue des Archives',
    'Paris',
    2.3554,
    48.859,
    [one('Salle de réunion (8 places)', 60, 6000), one('Grande salle (30 places)', 120, 15000)],
  ],
  [
    'espace-republique',
    'Espace République',
    'room',
    '3 rue du Faubourg du Temple',
    'Paris',
    2.364,
    48.867,
    [one('Bureau à l’heure', 60, 3500)],
  ],
  [
    'atelier-photo-belleville',
    'Atelier Photo Belleville',
    'photographer',
    '40 rue de Belleville',
    'Paris',
    2.383,
    48.872,
    [one('Séance studio', 60, 5500)],
  ],
  [
    'studio-repetition-pigalle',
    'Studio Répétition Pigalle',
    'other',
    '9 rue Frochot',
    'Paris',
    2.3375,
    48.8822,
    [one('Box de répétition', 60, 1800)],
  ],
  [
    'salle-des-fetes-versailles',
    'Salle des Fêtes de Versailles',
    'room',
    '6 avenue de Paris',
    'Versailles',
    2.1301,
    48.8049,
    [one('Salle de réception', 120, 12000)],
  ],
  // Lyon et alentours
  [
    'coiffure-bellecour',
    'Coiffure Bellecour',
    'hairdresser',
    '5 place Bellecour',
    'Lyon',
    4.832,
    45.7578,
    [one('Coupe', 30, 3000), one('Coupe + soin', 60, 5500)],
  ],
  [
    'barber-guillotiere',
    'Barber Guillotière',
    'hairdresser',
    '18 cours Gambetta',
    'Lyon',
    4.844,
    45.753,
    [one('Coupe homme', 30, 1800)],
  ],
  [
    'studio-confluence',
    'Studio Confluence',
    'photographer',
    '50 quai Rambaud',
    'Lyon',
    4.818,
    45.74,
    [one('Séance portrait', 60, 7000)],
  ],
  [
    'salle-part-dieu',
    'Salle Part-Dieu',
    'room',
    '20 boulevard Vivier-Merle',
    'Lyon',
    4.859,
    45.761,
    [one('Salle de réunion (12 places)', 60, 5000)],
  ],
  [
    'foot-a-5-villeurbanne',
    'Foot à 5 Villeurbanne',
    'sports_field',
    '110 rue du 4 Août 1789',
    'Villeurbanne',
    4.89,
    45.771,
    [one('Terrain synthétique', 60, 8500)],
  ],
  [
    'local-repete-vaise',
    'Local Répète Vaise',
    'other',
    '15 rue Marietton',
    'Lyon',
    4.805,
    45.779,
    [one('Studio de répétition', 60, 1500)],
  ],
  // Bordeaux et alentours
  [
    'coiffure-saint-pierre',
    'Coiffure Saint-Pierre',
    'hairdresser',
    '7 place Saint-Pierre',
    'Bordeaux',
    -0.572,
    44.84,
    [one('Coupe', 30, 2700)],
  ],
  [
    'studio-des-chartrons',
    'Studio des Chartrons',
    'photographer',
    '25 rue Notre-Dame',
    'Bordeaux',
    -0.57,
    44.854,
    [one('Séance studio', 60, 5000)],
  ],
  [
    'salle-de-la-victoire',
    'Salle de la Victoire',
    'room',
    '2 place de la Victoire',
    'Bordeaux',
    -0.573,
    44.831,
    [one('Salle de réunion (10 places)', 60, 4000)],
  ],
  [
    'padel-merignac',
    'Padel Mérignac',
    'sports_field',
    '8 avenue de l’Yser',
    'Mérignac',
    -0.645,
    44.84,
    [one('Piste de padel', 60, 2400)],
  ],
  // Aucune ressource active : ce prestataire ne doit jamais sortir dans la recherche.
  [
    'atelier-en-travaux',
    'Atelier en travaux',
    'other',
    '3 rue Sainte-Catherine',
    'Bordeaux',
    -0.5745,
    44.8395,
    [{ ...one('Atelier', 60, 3000), isActive: false }],
  ],
];

export const searchProviderSeeds: ProviderSeed[] = rows.map(
  ([slug, name, category, address, city, lng, lat, resources]) => ({
    email: `${slug}@example.com`,
    fullName: `Gérant ${name}`,
    name,
    slug,
    category,
    address,
    city,
    lng,
    lat,
    resources,
  }),
);
