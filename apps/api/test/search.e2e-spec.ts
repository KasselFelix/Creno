import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { providers, resources, toPoint, users } from '@creno/db';
import {
  apiErrorSchema,
  type ProviderCategory,
  type SearchProvidersResponse,
  searchProvidersResponseSchema,
} from '@creno/shared';
import { createTestApp, dbOf, resetDatabase } from './app.js';

// Centres à 3 décimales : c'est la précision gardée par le schéma de la recherche.
const PARIS = { lat: 48.864, lng: 2.37 };
const LYON = { lat: 45.764, lng: 4.836 };
const BORDEAUX = { lat: 44.838, lng: -0.579 };

interface ProviderSeed {
  name: string;
  lat: number;
  lng: number;
  category?: ProviderCategory;
  city?: string;
  /** Prix des ressources actives (une ressource par prix). */
  prices?: number[];
  /** Prix des ressources inactives. */
  inactivePrices?: number[];
}

let sequence = 0;

/** Insère des prestataires directement en base : la recherche ne dépend pas du parcours de création. */
async function insertProviders(app: INestApplication, seeds: ProviderSeed[]): Promise<void> {
  const { db } = dbOf(app);
  const base = (sequence += seeds.length) - seeds.length;
  const owners = await db
    .insert(users)
    .values(
      seeds.map((_, i) => ({
        email: `owner.${base + i}@test.dev`,
        fullName: 'Prestataire',
        role: 'provider' as const,
        passwordHash: 'hash-inutilisable',
      })),
    )
    .returning({ id: users.id });
  const created = await db
    .insert(providers)
    .values(
      seeds.map((seed, i) => ({
        userId: owners[i]!.id,
        name: seed.name,
        slug: `p-${base + i}`,
        category: seed.category ?? 'hairdresser',
        address: '1 rue du Test',
        city: seed.city ?? 'Paris',
        location: toPoint(seed.lng, seed.lat),
      })),
    )
    .returning({ id: providers.id });
  const rows = seeds.flatMap((seed, i) =>
    [
      ...(seed.prices ?? [3000]).map((priceCents) => ({ priceCents, isActive: true })),
      ...(seed.inactivePrices ?? []).map((priceCents) => ({ priceCents, isActive: false })),
    ].map((resource) => ({
      ...resource,
      providerId: created[i]!.id,
      name: 'Ressource',
      timezone: 'Europe/Paris',
      slotMinutes: 60,
    })),
  );
  if (rows.length > 0) await db.insert(resources).values(rows);
}

describe('search', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const search = async (query: string): Promise<SearchProvidersResponse> => {
    const res = await request(app.getHttpServer()).get(`/v1/search/providers?${query}`).expect(200);
    return searchProvidersResponseSchema.parse(res.body);
  };
  const around = (center: { lat: number; lng: number }, radiusKm: number) =>
    `lat=${center.lat}&lng=${center.lng}&radiusKm=${radiusKm}`;
  const names = (body: SearchProvidersResponse) => body.items.map((item) => item.name);

  describe('GET /v1/search/providers : rayon et distance', () => {
    it('ne renvoie que les prestataires du rayon, sans session', async () => {
      await insertProviders(app, [
        { name: 'Paris centre', ...PARIS },
        { name: 'Lyon centre', ...LYON, city: 'Lyon' },
        { name: 'Bordeaux centre', ...BORDEAUX, city: 'Bordeaux' },
      ]);
      expect(names(await search(around(PARIS, 5)))).toEqual(['Paris centre']);
      expect(names(await search(around(LYON, 50)))).toEqual(['Lyon centre']);
      // Longitude négative : Bordeaux est à l'ouest du méridien de Greenwich.
      expect(names(await search(around(BORDEAUX, 1)))).toEqual(['Bordeaux centre']);
    });

    it('ne confond pas longitude et latitude', async () => {
      await insertProviders(app, [{ name: 'Paris centre', ...PARIS }]);
      const body = await search(around(PARIS, 1));
      // Une inversion placerait le prestataire au large de la Somalie, à des milliers de km.
      expect(body.items[0]?.distanceMeters).toBeLessThan(100);
      expect(body.items[0]).toMatchObject({ latitude: PARIS.lat, longitude: PARIS.lng });
    });

    it('calcule la distance réelle en mètres et respecte la limite du rayon', async () => {
      // 0,01° de latitude ≈ 1 112 m à Paris (un degré de méridien ≈ 111,2 km).
      await insertProviders(app, [{ name: 'Au nord', lat: PARIS.lat + 0.01, lng: PARIS.lng }]);
      const within = await search(around(PARIS, 2));
      const distance = within.items[0]!.distanceMeters!;
      expect(distance).toBeGreaterThan(1112 * 0.99);
      expect(distance).toBeLessThan(1112 * 1.01);
      expect(await search(around(PARIS, 1))).toEqual({ items: [], total: 0 });
    });

    it('trie du plus proche au plus loin, avec un ordre stable à distance égale', async () => {
      await insertProviders(app, [
        { name: 'Loin', lat: PARIS.lat + 0.03, lng: PARIS.lng },
        { name: 'Même adresse B', lat: PARIS.lat + 0.01, lng: PARIS.lng },
        { name: 'Tout près', lat: PARIS.lat + 0.001, lng: PARIS.lng },
        { name: 'Même adresse A', lat: PARIS.lat + 0.01, lng: PARIS.lng },
      ]);
      const first = await search(around(PARIS, 10));
      const distances = first.items.map((item) => item.distanceMeters!);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      expect(names(first)[0]).toBe('Tout près');
      expect(names(first)[3]).toBe('Loin');
      expect(names(await search(around(PARIS, 10)))).toEqual(names(first));
    });

    it('sans centre, renvoie tous les prestataires triés par nom, sans distance', async () => {
      await insertProviders(app, [
        { name: 'Zèbre', ...LYON },
        { name: 'Atelier', ...PARIS },
        { name: 'Marché', ...BORDEAUX },
      ]);
      // `radiusKm` seul est ignoré.
      const body = await search('radiusKm=1');
      expect(names(body)).toEqual(['Atelier', 'Marché', 'Zèbre']);
      expect(body.items.every((item) => item.distanceMeters === null)).toBe(true);
      expect(body.total).toBe(3);
    });
  });

  describe('GET /v1/search/providers : filtres', () => {
    beforeEach(async () => {
      await insertProviders(app, [
        { name: 'Coiffeur pas cher', ...PARIS, category: 'hairdresser', prices: [2500, 7500] },
        { name: 'Coiffeur cher', ...PARIS, category: 'hairdresser', prices: [9000] },
        { name: 'Photographe', ...PARIS, category: 'photographer', prices: [4500] },
        // Sa seule ressource à bas prix est inactive : elle ne compte ni pour le prix ni pour le filtre.
        { name: 'Salle', ...PARIS, category: 'room', prices: [8000], inactivePrices: [1000] },
        { name: 'Sans ressource', ...PARIS, category: 'room', prices: [] },
        { name: 'Tout inactif', ...PARIS, category: 'room', prices: [], inactivePrices: [2000] },
      ]);
    });

    it('exclut les prestataires sans ressource active, y compris du total', async () => {
      const body = await search(around(PARIS, 5));
      expect(names(body).sort()).toEqual([
        'Coiffeur cher',
        'Coiffeur pas cher',
        'Photographe',
        'Salle',
      ]);
      expect(body.total).toBe(4);
      expect(names(await search(''))).not.toContain('Sans ressource');
    });

    it('filtre par catégorie', async () => {
      const body = await search(`${around(PARIS, 5)}&category=hairdresser`);
      expect(names(body).sort()).toEqual(['Coiffeur cher', 'Coiffeur pas cher']);
      expect(body.total).toBe(2);
    });

    it('filtre par prix maximum sur les ressources actives', async () => {
      const body = await search(`${around(PARIS, 5)}&priceMax=4500`);
      expect(names(body).sort()).toEqual(['Coiffeur pas cher', 'Photographe']);
    });

    it('combine catégorie et prix', async () => {
      expect(names(await search(`category=hairdresser&priceMax=3000`))).toEqual([
        'Coiffeur pas cher',
      ]);
      expect(await search(`category=photographer&priceMax=3000`)).toEqual({ items: [], total: 0 });
    });

    it('donne le prix minimum et le nombre de ressources actives', async () => {
      const body = await search(around(PARIS, 5));
      const byName = new Map(body.items.map((item) => [item.name, item]));
      expect(byName.get('Coiffeur pas cher')).toMatchObject({
        minPriceCents: 2500,
        resourceCount: 2,
        currency: 'EUR',
      });
      expect(byName.get('Salle')).toMatchObject({ minPriceCents: 8000, resourceCount: 1 });
    });

    it("n'expose que les champs publics", async () => {
      const res = await request(app.getHttpServer()).get('/v1/search/providers').expect(200);
      const item = (res.body as { items: Record<string, unknown>[] }).items[0]!;
      expect(Object.keys(item).sort()).toEqual([
        'address',
        'category',
        'city',
        'currency',
        'distanceMeters',
        'id',
        'latitude',
        'longitude',
        'minPriceCents',
        'name',
        'resourceCount',
        'slug',
      ]);
    });
  });

  describe('GET /v1/search/providers : plafond', () => {
    it('renvoie 50 résultats au plus et le total exact', async () => {
      await insertProviders(
        app,
        Array.from({ length: 60 }, (_, i) => ({ name: `Prestataire ${i}`, ...PARIS })),
      );
      const body = await search(around(PARIS, 5));
      expect(body.items).toHaveLength(50);
      expect(body.total).toBe(60);
      const limited = await search(`${around(PARIS, 5)}&limit=10`);
      expect(limited.items).toHaveLength(10);
      expect(limited.total).toBe(60);
    });
  });

  describe('GET /v1/search/providers : validation', () => {
    it.each([
      ['lat sans lng', 'lat=48.86'],
      ['lng sans lat', 'lng=2.37'],
      ['latitude hors bornes', 'lat=91&lng=2'],
      ['latitude non numérique', 'lat=paris&lng=2'],
      ['rayon nul', 'lat=48.86&lng=2.37&radiusKm=0'],
      ['rayon trop grand', 'lat=48.86&lng=2.37&radiusKm=51'],
      ['catégorie inconnue', 'category=plumber'],
      ['prix négatif', 'priceMax=-1'],
      ['limite nulle', 'limit=0'],
      ['limite trop grande', 'limit=51'],
      ['paramètre répété', 'category=room&category=other'],
    ])('400 VALIDATION_FAILED : %s', async (_label, query) => {
      const res = await request(app.getHttpServer())
        .get(`/v1/search/providers?${query}`)
        .expect(400);
      expect(apiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
    });
  });

  describe('limite de débit', () => {
    it('429 TOO_MANY_REQUESTS au-delà de la limite par minute', async () => {
      const limited = await createTestApp({ publicRateLimit: 3 });
      try {
        const url = '/v1/search/providers';
        for (let i = 0; i < 3; i++) await request(limited.getHttpServer()).get(url).expect(200);
        const res = await request(limited.getHttpServer()).get(url).expect(429);
        expect(apiErrorSchema.parse(res.body).code).toBe('TOO_MANY_REQUESTS');
      } finally {
        await limited.close();
      }
    });
  });
});
