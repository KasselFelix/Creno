// Données de démo. Idempotent : vide les tables métier puis réinsère le même jeu de données.
import { hash } from '@node-rs/argon2';
import { sql, type SQL } from 'drizzle-orm';
import { createDb } from './client.js';
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  providers,
  resources,
  toPoint,
  users,
} from './schema/index.js';

const HOLD_MS = 15 * 60 * 1000;
const TIMEZONE = 'Europe/Paris';

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

const providerSeeds = [
  {
    email: 'studio.lumiere@example.com',
    fullName: 'Claire Martin',
    name: 'Studio Lumière',
    slug: 'studio-lumiere',
    category: 'photographer' as const,
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
    category: 'hairdresser' as const,
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
    category: 'sports_field' as const,
    address: '1 avenue des 40 Journaux',
    city: 'Bordeaux',
    lng: -0.5667,
    lat: 44.8845,
    resources: [
      { name: 'Terrain 1 (5 contre 5)', slotMinutes: 60, priceCents: 9000 },
      { name: 'Terrain 2 (5 contre 5)', slotMinutes: 60, priceCents: 9000 },
    ],
  },
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
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`TRUNCATE sessions, bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
      );

      await tx
        .insert(users)
        .values({ email: 'admin@creno.dev', fullName: 'Admin Creno', role: 'admin', passwordHash });
      const customers = await tx
        .insert(users)
        .values([
          { email: 'lea.petit@example.com', fullName: 'Léa Petit', passwordHash },
          { email: 'tom.moreau@example.com', fullName: 'Tom Moreau', passwordHash },
        ])
        .returning({ id: users.id });

      const resourceIds: string[] = [];
      for (const p of providerSeeds) {
        const [owner] = await tx
          .insert(users)
          .values({ email: p.email, fullName: p.fullName, role: 'provider', passwordHash })
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

      await tx.insert(bookings).values([
        {
          resourceId: studioA!,
          customerId: customers[0]!.id,
          during: parisRange(day, '10:00', '11:00'),
          status: 'confirmed',
          priceCents: 4500,
        },
        {
          // Chevauche la réservation confirmée : autorisé car une réservation annulée ne bloque plus le créneau.
          resourceId: studioA!,
          customerId: customers[1]!.id,
          during: parisRange(day, '10:30', '11:30'),
          status: 'cancelled',
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
      `${JSON.stringify({ level: 'info', event: 'db.seeded', providers: providerSeeds.length, resources: 6, bookings: 3 })}\n`,
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
