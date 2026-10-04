import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  providers,
  resources,
  toPoint,
  toRange,
  users,
} from '@creno/db';
import {
  apiErrorSchema,
  type ProviderCategory,
  SEARCH_TIMEZONE,
  searchProvidersQuerySchema,
  type SearchProvidersResponse,
  searchProvidersResponseSchema,
  slotsResponseSchema,
} from '@creno/shared';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { wallTimeToInstant } from '../src/availability/slots.engine.js';
import { SearchService } from '../src/search/search.service.js';
import { createTestApp, dbOf, everyDay, instantIn, localDateIn, resetDatabase } from './app.js';

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
  /** Horaire de toutes ses ressources, tous les jours ; sans lui, aucun créneau. */
  hours?: [start: string, end: string];
}

interface InsertedProvider {
  id: string;
  resources: { id: string; priceCents: number; isActive: boolean }[];
}

let sequence = 0;

/** Insère des prestataires directement en base : la recherche ne dépend pas du parcours de création. */
async function insertProviders(
  app: INestApplication,
  seeds: ProviderSeed[],
): Promise<InsertedProvider[]> {
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
        emailVerifiedAt: new Date(),
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
  const inserted =
    rows.length > 0
      ? await db.insert(resources).values(rows).returning({
          id: resources.id,
          providerId: resources.providerId,
          priceCents: resources.priceCents,
          isActive: resources.isActive,
        })
      : [];
  const rules = seeds.flatMap((seed, i) => {
    const hours = seed.hours;
    if (!hours) return [];
    return inserted
      .filter((resource) => resource.providerId === created[i]!.id)
      .flatMap((resource) =>
        everyDay(...hours).map((rule) => ({ ...rule, resourceId: resource.id })),
      );
  });
  if (rules.length > 0) await db.insert(availabilityRules).values(rules);
  return created.map(({ id }) => ({
    id,
    resources: inserted
      .filter((resource) => resource.providerId === id)
      .map(({ id: resourceId, priceCents, isActive }) => ({
        id: resourceId,
        priceCents,
        isActive,
      })),
  }));
}

/** Ressource du prestataire à ce prix (un seul par prix dans ces tests). */
function resourceAt(provider: InsertedProvider, priceCents: number): string {
  return provider.resources.find((resource) => resource.priceCents === priceCents)!.id;
}

const PUBLIC_KEYS = [
  'address',
  'availableResourceId',
  'availableSlots',
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
];

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
      expect(await search(around(PARIS, 1))).toEqual({ items: [], total: 0, totalIsCapped: false });
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
      expect(await search(`category=photographer&priceMax=3000`)).toEqual({
        items: [],
        total: 0,
        totalIsCapped: false,
      });
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
      expect(Object.keys(item).sort()).toEqual(PUBLIC_KEYS);
    });

    it('sans date, availableSlots et availableResourceId valent null', async () => {
      const body = await search(around(PARIS, 5));
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item).toMatchObject({ availableSlots: null, availableResourceId: null });
      }
    });
  });

  describe('GET /v1/search/providers : filtre « disponible le »', () => {
    // Jamais aujourd'hui : les créneaux du jour dépendent de l'heure à laquelle le test tourne.
    const DAY = 7;
    const onDay = () => `date=${localDateIn(DAY)}`;
    let customerId: string;

    beforeEach(async () => {
      const [customer] = await dbOf(app)
        .db.insert(users)
        .values({
          email: `client.${(sequence += 1)}@test.dev`,
          fullName: 'Client',
          passwordHash: 'hash-inutilisable',
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id });
      customerId = customer!.id;
    });

    /** Réservation d'une heure ; `expiresInMinutes` négatif : hold déjà expiré. */
    async function book(
      resourceId: string,
      start: Date,
      status: 'confirmed' | 'pending' = 'confirmed',
      expiresInMinutes?: number,
    ): Promise<void> {
      await dbOf(app)
        .db.insert(bookings)
        .values({
          resourceId,
          customerId,
          during: toRange(start, new Date(start.getTime() + 60 * 60_000)),
          status,
          expiresAt:
            expiresInMinutes === undefined
              ? null
              : sql`now() + make_interval(mins => ${expiresInMinutes})`,
          priceCents: 3000,
        });
    }

    async function freeSlots(resourceId: string, date = localDateIn(DAY)): Promise<number> {
      const res = await request(app.getHttpServer())
        .get(`/v1/resources/${resourceId}/slots?from=${date}&to=${date}`)
        .expect(200);
      return slotsResponseSchema.parse(res.body).days[0]!.slots.filter((slot) => slot.available)
        .length;
    }

    const byName = (body: SearchProvidersResponse) =>
      new Map(body.items.map((item) => [item.name, item]));

    it('ne garde que les prestataires qui ont un créneau libre, comptés comme leurs créneaux', async () => {
      const [open, , twoPrices] = await insertProviders(app, [
        { name: 'Ouvert', ...PARIS, hours: ['09:00', '12:00'] },
        { name: 'Sans horaire', ...PARIS },
        { name: 'Deux ressources', ...PARIS, prices: [5000, 3000], hours: ['09:00', '12:00'] },
      ]);
      await book(open!.resources[0]!.id, instantIn(DAY, '10:00'));

      const body = await search(`${around(PARIS, 5)}&${onDay()}`);
      expect(names(body).sort()).toEqual(['Deux ressources', 'Ouvert']);
      expect(body).toMatchObject({ total: 2, totalIsCapped: false });
      const found = byName(body);
      expect(found.get('Ouvert')).toMatchObject({
        availableSlots: 2,
        availableResourceId: open!.resources[0]!.id,
      });
      expect(found.get('Ouvert')!.availableSlots).toBe(await freeSlots(open!.resources[0]!.id));
      // Somme des ressources ; le lien vise la moins chère des deux.
      expect(found.get('Deux ressources')).toMatchObject({
        availableSlots: 6,
        availableResourceId: resourceAt(twoPrices!, 3000),
      });
      expect(found.get('Deux ressources')!.availableSlots).toBe(
        (await freeSlots(resourceAt(twoPrices!, 3000))) +
          (await freeSlots(resourceAt(twoPrices!, 5000))),
      );
    });

    it('une réservation sur le dernier créneau libre exclut le prestataire, un hold expiré non', async () => {
      const inserted = await insertProviders(app, [
        { name: 'Complet', ...PARIS, hours: ['09:00', '12:00'] },
        { name: 'Hold expiré', ...PARIS, hours: ['09:00', '12:00'] },
        { name: 'Hold en cours', ...PARIS, hours: ['09:00', '12:00'] },
      ]);
      const [full, expiredHold, activeHold] = inserted.map((p) => p.resources[0]!.id);
      for (const resourceId of [full!, expiredHold!, activeHold!]) {
        await book(resourceId, instantIn(DAY, '09:00'));
        await book(resourceId, instantIn(DAY, '10:00'));
      }
      await book(full!, instantIn(DAY, '11:00'));
      await book(expiredHold!, instantIn(DAY, '11:00'), 'pending', -5);
      await book(activeHold!, instantIn(DAY, '11:00'), 'pending', 10);

      const body = await search(`${around(PARIS, 5)}&${onDay()}`);
      expect(names(body)).toEqual(['Hold expiré']);
      expect(body.items[0]!.availableSlots).toBe(1);
      expect(body.total).toBe(1);
    });

    it('400 SEARCH_DATE_OUT_OF_RANGE hier et à +91 jours (heure de Paris)', async () => {
      for (const days of [-1, 91]) {
        const res = await request(app.getHttpServer())
          .get(`/v1/search/providers?date=${localDateIn(days, SEARCH_TIMEZONE)}`)
          .expect(400);
        expect(apiErrorSchema.parse(res.body).code).toBe('SEARCH_DATE_OUT_OF_RANGE');
      }
      for (const days of [0, 90]) {
        await search(`date=${localDateIn(days, SEARCH_TIMEZONE)}`);
      }
    });

    it('ne compte ni une journée fermée ni une ressource inactive', async () => {
      const [closedDay, closedHour] = await insertProviders(app, [
        // La ressource inactive a un horaire : comptée par erreur, elle garderait le prestataire.
        { name: 'Fermé ce jour', ...PARIS, inactivePrices: [1000], hours: ['09:00', '12:00'] },
        { name: 'Fermé une heure', ...PARIS, hours: ['09:00', '12:00'] },
      ]);
      await dbOf(app)
        .db.insert(availabilityExceptions)
        .values([
          {
            resourceId: resourceAt(closedDay!, 3000),
            during: toRange(instantIn(DAY, '00:00'), instantIn(DAY + 1, '00:00')),
            reason: 'Fermeture exceptionnelle',
          },
          {
            resourceId: resourceAt(closedHour!, 3000),
            during: toRange(instantIn(DAY, '09:00'), instantIn(DAY, '10:00')),
            reason: null,
          },
        ]);

      const body = await search(`${around(PARIS, 5)}&${onDay()}`);
      expect(names(body)).toEqual(['Fermé une heure']);
      expect(body.items[0]!.availableSlots).toBe(2);
    });

    it('avec un prix maximum, seules les ressources à ce prix ou moins comptent', async () => {
      const [cheapFull, bothFree] = await insertProviders(app, [
        { name: 'Moins cher complet', ...PARIS, prices: [2000, 6000], hours: ['09:00', '12:00'] },
        { name: 'Deux prix libres', ...PARIS, prices: [2000, 6000], hours: ['09:00', '12:00'] },
      ]);
      for (const time of ['09:00', '10:00', '11:00']) {
        await book(resourceAt(cheapFull!, 2000), instantIn(DAY, time));
      }

      const cheap = await search(`${around(PARIS, 5)}&${onDay()}&priceMax=3000`);
      expect(names(cheap)).toEqual(['Deux prix libres']);
      expect(cheap.items[0]).toMatchObject({
        availableSlots: 3,
        availableResourceId: resourceAt(bothFree!, 2000),
      });

      const found = byName(await search(`${around(PARIS, 5)}&${onDay()}&priceMax=7000`));
      expect(found.get('Moins cher complet')).toMatchObject({
        availableSlots: 3,
        availableResourceId: resourceAt(cheapFull!, 6000),
      });
      expect(found.get('Deux prix libres')).toMatchObject({
        availableSlots: 6,
        availableResourceId: resourceAt(bothFree!, 2000),
      });
    });

    it("n'expose que les champs publics", async () => {
      await insertProviders(app, [{ name: 'Ouvert', ...PARIS, hours: ['09:00', '12:00'] }]);
      const res = await request(app.getHttpServer())
        .get(`/v1/search/providers?${onDay()}`)
        .expect(200);
      const body = res.body as { items: Record<string, unknown>[] } & Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['items', 'total', 'totalIsCapped']);
      expect(Object.keys(body.items[0]!).sort()).toEqual(PUBLIC_KEYS);
    });

    it('coupe à 50 résultats dans l’ordre des distances, après le filtre', async () => {
      const seeds = Array.from({ length: 70 }, (_, i): ProviderSeed => ({
        name: `D${String(i).padStart(2, '0')}`,
        // ≈ 55 m de plus à chaque prestataire ; un sur sept n'a aucun créneau.
        lat: PARIS.lat + i * 0.0005,
        lng: PARIS.lng,
        hours: i % 7 === 0 ? undefined : ['09:00', '12:00'],
      }));
      await insertProviders(app, seeds);

      const body = await search(`${around(PARIS, 10)}&${onDay()}`);
      const expected = seeds.filter((seed) => seed.hours).map((seed) => seed.name);
      expect(names(body)).toEqual(expected.slice(0, 50));
      expect(body).toMatchObject({ total: 60, totalIsCapped: false });
    });

    it('sans centre, examine les 200 premiers par nom ; au-delà, le total est un minimum', async () => {
      const inserted = await insertProviders(
        app,
        Array.from({ length: 201 }, (_, i) => ({
          name: `P${String(i).padStart(3, '0')}`,
          ...PARIS,
          // Les trois premiers par nom n'ont aucun créneau.
          hours: i < 3 ? undefined : (['09:00', '12:00'] as [string, string]),
        })),
      );

      const body = await search(onDay());
      // 200 examinés, dont 3 sans créneau : le 201e (P200), pourtant libre, n'est pas compté.
      expect(body).toMatchObject({ total: 197, totalIsCapped: true });
      expect(body.items).toHaveLength(50);
      expect(names(body)[0]).toBe('P003');
      expect(names(body).at(-1)).toBe('P052');
      // Sans date, le total reste exact.
      expect(await search('')).toMatchObject({ total: 201, totalIsCapped: false });

      // 200 candidats tout juste : tous sont examinés, le total est exact.
      await dbOf(app)
        .db.update(resources)
        .set({ isActive: false })
        .where(eq(resources.providerId, inserted[200]!.id));
      expect(await search(onDay())).toMatchObject({ total: 197, totalIsCapped: false });
    });

    describe('avec un instant fixé', () => {
      const query = (date: string) => searchProvidersQuerySchema.parse({ date });
      const countFree = (slots: { available: boolean }[]) =>
        slots.filter((slot) => slot.available).length;

      it('ignore les créneaux déjà passés aujourd’hui', async () => {
        const [provider] = await insertProviders(app, [
          { name: 'Ouvert jour et nuit', ...PARIS, hours: ['00:00', '24:00'] },
        ]);
        const resourceId = provider!.resources[0]!.id;
        const today = localDateIn(0);
        const now = wallTimeToInstant(today, '12:30', 'Europe/Paris');

        const result = await app.get(SearchService).searchProviders(query(today), now);
        const slots = await app
          .get(AvailabilityService)
          .getSlots(resourceId, { from: today, to: today }, now);
        // De 13:00 à 23:00.
        expect(result.items[0]!.availableSlots).toBe(11);
        expect(countFree(slots.days[0]!.slots)).toBe(11);
      });

      it.each([
        ["passage à l'heure d'hiver", '2026-10-25', '2026-10-20T10:00:00Z', 25],
        ["passage à l'heure d'été", '2027-03-28', '2027-03-20T10:00:00Z', 23],
      ])('un jour de %s, compte comme getSlots', async (_label, day, instant, hours) => {
        const [provider] = await insertProviders(app, [
          { name: 'Ouvert jour et nuit', ...PARIS, hours: ['00:00', '24:00'] },
        ]);
        const resourceId = provider!.resources[0]!.id;
        const now = new Date(instant);
        const availability = app.get(AvailabilityService);
        const range = { from: day, to: day };

        const before = await availability.getSlots(resourceId, range, now);
        expect(before.days[0]!.slots).toHaveLength(hours);
        // Le troisième créneau : celui qui suit (ou saute) l'heure qui change.
        const third = before.days[0]!.slots[2]!;
        await book(resourceId, new Date(third.start));

        const after = await availability.getSlots(resourceId, range, now);
        const result = await app.get(SearchService).searchProviders(query(day), now);
        expect(countFree(after.days[0]!.slots)).toBe(hours - 1);
        expect(result.items[0]!.availableSlots).toBe(hours - 1);
      });
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
      expect(body.totalIsCapped).toBe(false);
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
      ['date impossible', 'date=2026-02-30'],
      ['date en texte', 'date=demain'],
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
