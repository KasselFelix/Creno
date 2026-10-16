// Données de démo. Idempotent : vide les tables métier puis réinsère le même jeu de données.
import { sql, type SQL } from 'drizzle-orm';
import type { PgInsertValue } from 'drizzle-orm/pg-core';
import type { Database } from './client.js';
import {
  FULL_ON_SATURDAY,
  HOURS,
  type ProviderSeed,
  type RuleSeed,
  searchProviderSeeds,
} from './seed-providers.js';
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  payments,
  providers,
  resources,
  toPoint,
  users,
} from './schema/index.js';

const HOLD_MS = 15 * 60 * 1000;
const TIMEZONE = 'Europe/Paris';

/** Commission de démo (10 %), comme la valeur par défaut de `STRIPE_PLATFORM_FEE_BPS`. */
const DEMO_FEE_BPS = 1000;

/** Mot de passe de tous les comptes de démo (public : documenté dans le README). */
export const DEMO_PASSWORD = 'creno-demo-2026';

/** Jour de la semaine (0 = dimanche … 6 = samedi) à Paris, `days` jours après aujourd'hui. */
function parisWeekdayIn(days: number): number {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.getUTCDay();
}

/** Nombre de jours jusqu'au prochain jour ouvré (lundi à vendredi) à Paris, à partir de demain. */
function daysToNextWeekday(): number {
  for (let days = 1; ; days++) {
    const weekday = parisWeekdayIn(days);
    if (weekday >= 1 && weekday <= 5) return days;
  }
}

/**
 * Nombre de jours jusqu'au prochain samedi à Paris, aujourd'hui compris : le jour que désigne
 * « samedi » dans une recherche en langage naturel.
 */
function daysToSaturday(): number {
  return (6 - parisWeekdayIn(0) + 7) % 7;
}

/**
 * Créneaux `[début, fin)` d'une plage horaire, en heures `HH:mm`. Calcul en heures murales : les
 * plages de démo sont en journée, loin des changements d'heure.
 */
function slotsOf(rule: RuleSeed, slotMinutes: number): { start: string; end: string }[] {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const hhmm = (total: number) =>
    `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  const slots: { start: string; end: string }[] = [];
  for (
    let at = minutes(rule.startTime);
    at + slotMinutes <= minutes(rule.endTime);
    at += slotMinutes
  ) {
    slots.push({ start: hhmm(at), end: hhmm(at + slotMinutes) });
  }
  return slots;
}

/**
 * Créneau `[start, end)` en heure de Paris, `days` jours après aujourd'hui. `AT TIME ZONE` convertit
 * l'heure locale en instant : la démo tombe sur la grille des horaires, été comme hiver.
 */
function parisRange(days: number, start: string, end: string): SQL {
  const at = (time: string) =>
    sql`(((now() AT TIME ZONE ${TIMEZONE})::date + ${days}::int) + ${time}::time) AT TIME ZONE ${TIMEZONE}`;
  return sql`tstzrange(${at(start)}, ${at(end)}, '[)')`;
}

// Les trois premiers servent aux parcours de démo (créneaux, réservations) ; les suivants à la recherche.
// Les trois de démo gardent le même horaire (semaine 9-18 h, samedi 10-14 h).
const providerSeeds: ProviderSeed[] = [
  {
    email: 'studio.lumiere@example.com',
    fullName: 'Claire Martin',
    name: 'Studio Lumière',
    slug: 'studio-lumiere',
    category: 'photographer',
    address: '12 rue Oberkampf',
    city: 'Paris',
    lng: 2.3696,
    lat: 48.8644,
    resources: [
      { name: 'Studio A (fond blanc)', slotMinutes: 60, priceCents: 4500 },
      { name: 'Séance portrait', slotMinutes: 30, priceCents: 6000 },
    ],
    hours: 'weekdaysAndSaturday',
  },
  {
    email: 'coupe.croix-rousse@example.com',
    fullName: 'Karim Benali',
    name: 'Salon Croix-Rousse',
    slug: 'salon-croix-rousse',
    category: 'hairdresser',
    address: '4 place de la Croix-Rousse',
    city: 'Lyon',
    lng: 4.8317,
    lat: 45.7745,
    resources: [
      { name: 'Coupe homme', slotMinutes: 30, priceCents: 2500 },
      { name: 'Coupe + couleur', slotMinutes: 90, priceCents: 7500 },
    ],
    hours: 'weekdaysAndSaturday',
  },
  {
    email: 'five.bordeaux@example.com',
    fullName: 'Julie Durand',
    name: 'Five Bordeaux Lac',
    slug: 'five-bordeaux-lac',
    category: 'sports_field',
    address: '1 avenue des 40 Journaux',
    city: 'Bordeaux',
    lng: -0.5667,
    lat: 44.8845,
    resources: [
      { name: 'Terrain 1 (5 contre 5)', slotMinutes: 60, priceCents: 9000 },
      { name: 'Terrain 2 (5 contre 5)', slotMinutes: 60, priceCents: 9000 },
    ],
    hours: 'weekdaysAndSaturday',
  },
  ...searchProviderSeeds,
];

export interface DemoSeedOptions {
  /** Hash argon2 de `DEMO_PASSWORD` (calculé par l'appelant, qui a la dépendance). */
  passwordHash: string;
  /**
   * Compte Stripe Express de test rattaché à « Studio Lumière » : sans lui, aucun prestataire de
   * démo n'encaisse.
   */
  stripeAccountId: string | null;
  /**
   * Compte admin (il peut lister tous les utilisateurs). Jamais sur la démo publique : son mot de
   * passe est dans le README.
   */
  includeAdmin: boolean;
}

export interface DemoSeedSummary {
  providers: number;
  resources: number;
  bookings: number;
}

/** Vide les tables métier et insère le jeu de démo, dans une transaction. */
export async function seedDemo(db: Database, options: DemoSeedOptions): Promise<DemoSeedSummary> {
  const { passwordHash, stripeAccountId: demoStripeAccountId } = options;
  if (demoStripeAccountId && !/^acct_[A-Za-z0-9]+$/.test(demoStripeAccountId)) {
    throw new Error('SEED_STRIPE_ACCOUNT_ID doit être un identifiant de compte Stripe (acct_…)');
  }
  const fullSaturday: PgInsertValue<typeof bookings>[] = [];
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`TRUNCATE pending_registrations, phone_verifications, notifications, sessions, stripe_events, payments, bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
    );

    // Comptes de démo : adresses réputées confirmées (l'inscription réelle passe par un lien).
    const account = { passwordHash, emailVerifiedAt: new Date() };
    if (options.includeAdmin) {
      await tx
        .insert(users)
        .values({ email: 'admin@creno.dev', fullName: 'Admin Creno', role: 'admin', ...account });
    }
    const customers = await tx
      .insert(users)
      .values([
        {
          email: 'lea.petit@example.com',
          fullName: 'Léa Petit',
          // Plage réservée à la fiction par l'ARCEP (06 39 98 xx xx) : n'appartient à personne.
          phone: '+33639980001',
          phoneVerifiedAt: new Date(),
          ...account,
        },
        { email: 'tom.moreau@example.com', fullName: 'Tom Moreau', ...account },
      ])
      .returning({ id: users.id });

    const resourceIds: string[] = [];
    for (const p of providerSeeds) {
      const [owner] = await tx
        .insert(users)
        .values({ email: p.email, fullName: p.fullName, role: 'provider', ...account })
        .returning({ id: users.id });
      const [provider] = await tx
        .insert(providers)
        .values({
          userId: owner!.id,
          name: p.name,
          slug: p.slug,
          category: p.category,
          address: p.address,
          city: p.city,
          location: toPoint(p.lng, p.lat),
          // Stripe confirmera l'état réel du compte au prochain `account.updated`.
          ...(demoStripeAccountId && p.slug === 'studio-lumiere'
            ? {
                stripeAccountId: demoStripeAccountId,
                stripeChargesEnabled: true,
                stripeDetailsSubmitted: true,
              }
            : {}),
        })
        .returning({ id: providers.id });

      for (const r of p.resources) {
        const [resource] = await tx
          .insert(resources)
          .values({ providerId: provider!.id, timezone: TIMEZONE, ...r })
          .returning({ id: resources.id });
        resourceIds.push(resource!.id);

        const rules = HOURS[p.hours];
        await tx
          .insert(availabilityRules)
          .values(rules.map((rule) => ({ resourceId: resource!.id, ...rule })));

        // Réservations confirmées sur tous les créneaux du prochain samedi.
        if (p.slug !== FULL_ON_SATURDAY) continue;
        for (const rule of rules.filter((rule) => rule.weekday === 6)) {
          for (const slot of slotsOf(rule, r.slotMinutes)) {
            fullSaturday.push({
              resourceId: resource!.id,
              customerId: customers[1]!.id,
              during: parisRange(daysToSaturday(), slot.start, slot.end),
              status: 'confirmed',
              confirmedAt: new Date(),
              priceCents: r.priceCents,
            });
          }
        }
      }
    }
    if (fullSaturday.length > 0) await tx.insert(bookings).values(fullSaturday);

    const [studioA] = resourceIds;
    const day = daysToNextWeekday();
    // Fermeture d'une journée entière, de minuit à minuit en heure locale de la ressource.
    await tx.insert(availabilityExceptions).values({
      resourceId: studioA!,
      during: parisRange(day + 7, '00:00', '24:00'),
      reason: 'Maintenance des éclairages',
    });

    const [confirmed] = await tx
      .insert(bookings)
      .values({
        resourceId: studioA!,
        customerId: customers[0]!.id,
        during: parisRange(day, '10:00', '11:00'),
        status: 'confirmed',
        confirmedAt: new Date(),
        priceCents: 4500,
      })
      .returning({ id: bookings.id });
    // Paiement fictif de la réservation confirmée : il n'existe pas chez Stripe, donc une
    // annulation de cette réservation de démo échouera au remboursement.
    await tx.insert(payments).values({
      bookingId: confirmed!.id,
      stripePaymentIntentId: 'pi_seed_demo',
      amountCents: 4500,
      feeCents: (4500 * DEMO_FEE_BPS) / 10_000,
      currency: 'EUR',
    });

    await tx.insert(bookings).values([
      {
        // Chevauche la réservation confirmée : autorisé car une réservation annulée ne bloque plus le créneau.
        resourceId: studioA!,
        customerId: customers[1]!.id,
        during: parisRange(day, '10:30', '11:30'),
        status: 'cancelled',
        confirmedAt: new Date(),
        cancelledAt: new Date(),
        priceCents: 4500,
      },
      {
        // Hold de paiement : il occupe 14:00 pendant 15 minutes, puis le créneau redevient libre.
        resourceId: studioA!,
        customerId: customers[1]!.id,
        during: parisRange(day, '14:00', '15:00'),
        status: 'pending',
        expiresAt: new Date(Date.now() + HOLD_MS),
        priceCents: 4500,
      },
    ]);

    // Semaine en cours du Studio Lumière (jours passés compris) : le dashboard prestataire
    // affiche une occupation et un CA non nuls. Sans paiement : une annulation de démo n'a
    // rien à rembourser chez Stripe, donc elle aboutit.
    const [, portrait] = resourceIds;
    const monday = -((parisWeekdayIn(0) + 6) % 7);
    const currentWeek: PgInsertValue<typeof bookings>[] = [];
    for (let weekday = 0; weekday < 5; weekday++) {
      const customerId = customers[weekday % 2]!.id;
      currentWeek.push(
        {
          resourceId: studioA!,
          customerId,
          during: parisRange(monday + weekday, '16:00', '17:00'),
          status: 'confirmed',
          confirmedAt: new Date(),
          priceCents: 4500,
        },
        {
          resourceId: portrait!,
          customerId,
          during: parisRange(monday + weekday, '11:00', '11:30'),
          status: 'confirmed',
          confirmedAt: new Date(),
          priceCents: 6000,
        },
      );
    }
    await tx.insert(bookings).values(currentWeek);
  });

  return {
    providers: providerSeeds.length,
    resources: providerSeeds.reduce((n, p) => n + p.resources.length, 0),
    bookings: 3 + 10 + fullSaturday.length,
  };
}
