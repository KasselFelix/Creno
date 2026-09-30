// Données de démo. Idempotent : vide les tables métier puis réinsère le même jeu de données.
import { sql } from 'drizzle-orm';
import { createDb } from './client.js';
import {
  availabilityExceptions,
  availabilityRules,
  bookings,
  providers,
  resources,
  toPoint,
  toRange,
  users,
} from './schema/index.js';

const HOUR = 60 * 60 * 1000;

/** Demain à `hour`:00 UTC, décalé de `days` jours. */
function dayAt(days: number, hour: number, minutes = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1 + days);
  d.setUTCHours(hour, minutes, 0, 0);
  return d;
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
  const { db, pool } = createDb(url, { max: 1 });

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`TRUNCATE bookings, availability_exceptions, availability_rules, resources, providers, users RESTART IDENTITY CASCADE`,
      );

      await tx.insert(users).values({ email: 'admin@creno.dev', fullName: 'Admin Creno', role: 'admin' });
      const customers = await tx
        .insert(users)
        .values([
          { email: 'lea.petit@example.com', fullName: 'Léa Petit' },
          { email: 'tom.moreau@example.com', fullName: 'Tom Moreau' },
        ])
        .returning({ id: users.id });

      const resourceIds: string[] = [];
      for (const p of providerSeeds) {
        const [owner] = await tx
          .insert(users)
          .values({ email: p.email, fullName: p.fullName, role: 'provider' })
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
            .values({ providerId: provider!.id, timezone: 'Europe/Paris', ...r })
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
      await tx.insert(availabilityExceptions).values({
        resourceId: studioA!,
        during: toRange(dayAt(7, 0), dayAt(8, 0)),
        reason: 'Maintenance des éclairages',
      });

      await tx.insert(bookings).values([
        {
          resourceId: studioA!,
          customerId: customers[0]!.id,
          during: toRange(dayAt(0, 8), dayAt(0, 9)),
          status: 'confirmed',
          priceCents: 4500,
        },
        {
          // Chevauche la réservation confirmée : autorisé car une réservation annulée ne bloque plus le créneau.
          resourceId: studioA!,
          customerId: customers[1]!.id,
          during: toRange(dayAt(0, 8, 30), dayAt(0, 9, 30)),
          status: 'cancelled',
          priceCents: 4500,
        },
        {
          resourceId: studioA!,
          customerId: customers[1]!.id,
          during: toRange(dayAt(0, 10), dayAt(0, 11)),
          status: 'pending',
          expiresAt: new Date(Date.now() + HOUR / 4),
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
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'db.seed_failed', error: String(error) })}\n`);
  process.exit(1);
});
