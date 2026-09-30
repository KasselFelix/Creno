import { customType } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

/** Intervalle de temps `[début, fin)` en UTC, ex. `["2026-10-01 08:00:00+00","2026-10-01 09:00:00+00")`. */
export const tstzrange = customType<{ data: string }>({ dataType: () => 'tstzrange' });

/** Point géographique WGS84 : distances en mètres, index GiST sphérique. */
export const geographyPoint = customType<{ data: string }>({
  dataType: () => 'geography(Point,4326)',
});

/** Texte insensible à la casse (extension citext), pour les emails. */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** Construit une valeur `tstzrange` semi-ouverte `[start, end)`. */
export function toRange(start: Date, end: Date): string {
  return `[${start.toISOString()},${end.toISOString()})`;
}

/** Construit un point géographique. Attention à l'ordre : longitude puis latitude. */
export function toPoint(lng: number, lat: number): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
}
