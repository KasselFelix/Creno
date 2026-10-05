import { Injectable } from '@nestjs/common';
import type { ProviderStats, StatsQuery } from '@creno/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { StatsRepository } from './stats.repository.js';

const occupancy = (booked: number, open: number) => (open > 0 ? Math.min(booked / open, 1) : null);

@Injectable()
export class StatsService {
  constructor(private readonly stats: StatsRepository) {}

  /**
   * Occupation et chiffre d'affaires d'une semaine. La requête ne porte que sur les ressources
   * du prestataire connecté : la propriété est dans le `WHERE`, pas dans un contrôle à part.
   */
  async week(current: AuthUser, { weekStart }: StatsQuery): Promise<ProviderStats> {
    const rows = await this.stats.weekOf(current.id, weekStart);
    const resources = rows.map((row) => ({
      resourceId: row.resource_id,
      name: row.name,
      isActive: row.is_active,
      openMinutes: row.open_minutes,
      bookedMinutes: row.booked_minutes,
      occupancy: occupancy(row.booked_minutes, row.open_minutes),
      revenueCents: row.revenue_cents,
      confirmedCount: row.confirmed_count,
    }));
    const sum = (pick: (row: (typeof resources)[number]) => number) =>
      resources.reduce((total, row) => total + pick(row), 0);
    const openMinutes = sum((row) => row.openMinutes);
    const bookedMinutes = sum((row) => row.bookedMinutes);
    return {
      weekStart,
      // Toutes les ressources sont en euros : la devise n'est pas modifiable aujourd'hui.
      currency: 'EUR',
      resources,
      totals: {
        openMinutes,
        bookedMinutes,
        occupancy: occupancy(bookedMinutes, openMinutes),
        revenueCents: sum((row) => row.revenueCents),
        confirmedCount: sum((row) => row.confirmedCount),
      },
    };
  }
}
