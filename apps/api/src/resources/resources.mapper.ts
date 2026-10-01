import type { Resource } from '@creno/shared';
import type { ResourceRow } from './resources.repository.js';

export function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    providerId: row.providerId,
    name: row.name,
    description: row.description,
    timezone: row.timezone,
    slotMinutes: row.slotMinutes,
    priceCents: row.priceCents,
    currency: row.currency,
    isActive: row.isActive,
  };
}
