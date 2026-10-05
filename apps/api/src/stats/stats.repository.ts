import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DbHandle } from '@creno/db';
import { DB } from '../database/database.module.js';

// Index signature : exigée par `db.execute<T>()`.
export interface ResourceStatsRow extends Record<string, unknown> {
  resource_id: string;
  name: string;
  is_active: boolean;
  open_minutes: number;
  booked_minutes: number;
  revenue_cents: number;
  confirmed_count: number;
}

@Injectable()
export class StatsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Occupation d'une semaine, ressource par ressource, pour le prestataire `ownerUserId`.
   *
   * La semaine est `[weekStart 00:00, weekStart+7 00:00)` dans le fuseau de CHAQUE ressource.
   * 1. Ouverture : chaque horaire hebdomadaire (heure locale) devient, jour par jour, une plage
   *    d'instants (`AT TIME ZONE`, donc un jour de 23 h ou 25 h a sa vraie durée). Les plages sont
   *    réunies en un multirange (`range_agg`), dont on retire les fermetures (`-`).
   * 2. Réservé : le multirange des réservations confirmées, coupé par l'ouverture (`*`). Une
   *    réservation sous une fermeture ne compte donc pas.
   * 3. Les durées s'additionnent en dépliant le multirange (`unnest`).
   * Le CA et le nombre de réservations ne comptent que celles qui COMMENCENT dans la semaine.
   */
  async weekOf(ownerUserId: string, weekStart: string): Promise<ResourceStatsRow[]> {
    const result = await this.handle.db.execute<ResourceStatsRow>(sql`
      WITH res AS (
        SELECT r.id, r.name, r.is_active, r.timezone,
               tstzrange(
                 ${weekStart}::date::timestamp AT TIME ZONE r.timezone,
                 (${weekStart}::date + 7)::timestamp AT TIME ZONE r.timezone,
                 '[)'
               ) AS week
        FROM resources r
        JOIN providers p ON p.id = r.provider_id
        WHERE p.user_id = ${ownerUserId}
      ),
      open_time AS (
        SELECT res.id AS resource_id,
               coalesce(
                 (SELECT range_agg(
                           -- greatest() : une plage qui s'inverse dans le trou du passage à
                           -- l'heure d'été devient vide au lieu de lever une erreur.
                           tstzrange(o.lower_at, greatest(o.lower_at, o.upper_at), '[)'))
                  -- Les 7 dates locales de la semaine (date + entier : pas de fuseau en jeu).
                  FROM generate_series(0, 6) AS i
                  CROSS JOIN LATERAL (SELECT ${weekStart}::date + i AS day) d
                  JOIN availability_rules ar
                    ON ar.resource_id = res.id AND ar.weekday = extract(isodow FROM d.day)
                  CROSS JOIN LATERAL (
                    SELECT (d.day + ar.start_time) AT TIME ZONE res.timezone AS lower_at,
                           (d.day + ar.end_time) AT TIME ZONE res.timezone AS upper_at
                  ) o
                  -- Une ressource désactivée ne propose rien : aucune minute d'ouverture.
                  WHERE res.is_active),
                 '{}'::tstzmultirange
               )
               - coalesce(
                   (SELECT range_agg(e.during)
                    FROM availability_exceptions e
                    WHERE e.resource_id = res.id AND e.during && res.week),
                   '{}'::tstzmultirange
                 ) AS open
        FROM res
      ),
      booked AS (
        SELECT res.id AS resource_id,
               range_agg(b.during) AS during,
               count(*) FILTER (WHERE lower(b.during) <@ res.week)::int AS confirmed_count,
               coalesce(sum(b.price_cents) FILTER (WHERE lower(b.during) <@ res.week), 0)::int
                 AS revenue_cents
        FROM res
        JOIN bookings b
          ON b.resource_id = res.id AND b.status = 'confirmed' AND b.during && res.week
        GROUP BY res.id
      )
      SELECT res.id AS resource_id, res.name, res.is_active,
             round(extract(epoch FROM open_len.total) / 60)::int AS open_minutes,
             round(extract(epoch FROM booked_len.total) / 60)::int AS booked_minutes,
             coalesce(bk.revenue_cents, 0) AS revenue_cents,
             coalesce(bk.confirmed_count, 0) AS confirmed_count
      FROM res
      JOIN open_time ot ON ot.resource_id = res.id
      LEFT JOIN booked bk ON bk.resource_id = res.id
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(upper(r) - lower(r)), interval '0') AS total FROM unnest(ot.open) AS r
      ) open_len
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(upper(r) - lower(r)), interval '0') AS total
        FROM unnest(ot.open * coalesce(bk.during, '{}'::tstzmultirange)) AS r
      ) booked_len
      ORDER BY res.name, res.id
    `);
    return result.rows;
  }
}
