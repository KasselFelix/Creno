// Données de démo. Idempotent : vide les tables métier puis réinsère le même jeu de données.
import { hash } from '@node-rs/argon2';
import { sql, type SQL } from 'drizzle-orm';
import { createDb } from './client.js';
import { type ProviderSeed, searchProviderSeeds } from './seed-providers.js';
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

/** Mot de passe de tous les comptes de démo (développement uniquement, documenté dans le README). */
export const DEMO_PASSWORD = 'creno-demo-2026';

/** Nombre de jours jusqu'au prochain jour ouvré (lundi à vendredi) à Paris, à partir de demain. */
function daysToNextWeekday(): number {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
  for (let days = 1; ; days++) {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) return days;
  }
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
  },
  ...searchProviderSeeds,
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');
  // Le seed vide les tables métier : jamais en production.
  if (process.env.NODE_ENV === 'production') throw new Error('Seed interdit en production');
  const { db, pool } = createDb(url, { max: 1 });

  try {
    // `--if-empty` (démarrage de docker compose) : on ne touche pas à une base qui contient déjà des
    // comptes, sinon chaque redémarrage effacerait les utilisateurs créés et invaliderait leurs sessions.
    if (process.argv.includes('--if-empty')) {
      const [existing] = await db.select({ id: users.id }).from(users).limit(1);
      if (existing) {
        process.stdout.write(
          `${JSON.stringify({ level: 'info', event: 'db.seed_skipped', reason: 'not_empty' })}\n`,
        );
        return;
      }
    }
    const passwordHash = await hash(DEMO_PASSWORD);
    // Compte Stripe Express de test, créé une fois par l'onboarding : le rattacher ici évite de
    // refaire l'onboarding après chaque seed. Sans lui, aucun prestataire de démo n'encaisse.
    const demoStripeAccountId = process.env.SEED_STRIPE_ACCOUNT_ID?.trim() || null;
    if (demoStripeAccountId && !/^acct_[A-Za-z0-9]+$/.test(demoStripeAccountId)) {
      throw new Error('SEED_STRIPE_ACCOUNT_ID doit être un identifiant de compte Stripe (acct_…)');
    }
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`TRUNCATE pending_registrations, notifications, sessions, stripe_events, payments, bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
      );

      // Comptes de démo : adresses réputées confirmées (l'inscription réelle passe par un lien).
      const account = { passwordHash, emailVerifiedAt: new Date() };
      await tx
        .insert(users)
        .values({ email: 'admin@creno.dev', fullName: 'Admin Creno', role: 'admin', ...account });
      const customers = await tx
        .insert(users)
        .values([
          { email: 'lea.petit@example.com', fullName: 'Léa Petit', ...account },
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

          await tx.insert(availabilityRules).values([
            ...[1, 2, 3, 4, 5].map((weekday) => ({
              resourceId: resource!.id,
              weekday,
              startTime: '09:00',
              endTime: '18:00',
            })),
            { resourceId: resource!.id, weekday: 6, startTime: '10:00', endTime: '14:00' },
          ]);
        }
      }

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
    });

    process.stdout.write(
      `${JSON.stringify({ level: 'info', event: 'db.seeded', providers: providerSeeds.length, resources: providerSeeds.reduce((n, p) => n + p.resources.length, 0), bookings: 3 })}\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', event: 'db.seed_failed', error: String(error) })}\n`,
  );
  process.exit(1);
});
