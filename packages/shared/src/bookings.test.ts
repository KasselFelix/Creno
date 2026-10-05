import { describe, expect, it } from 'vitest';
import { calendarQuerySchema, providerBookingsQuerySchema } from './index.js';

const resourceId = '0b6c1f5e-7d0a-4a8e-9a43-1f0f5c3b2d11';

describe('calendarQuerySchema', () => {
  it('accepte une semaine', () => {
    const query = {
      resourceId,
      from: '2026-10-19T00:00:00+02:00',
      to: '2026-10-26T00:00:00+01:00',
    };
    expect(calendarQuerySchema.safeParse(query).success).toBe(true);
  });

  it('refuse plus de 42 jours', () => {
    const query = { resourceId, from: '2026-10-01T00:00:00Z', to: '2026-11-12T00:00:01Z' };
    expect(calendarQuerySchema.safeParse(query).success).toBe(false);
  });

  it('refuse une plage vide ou inversée', () => {
    const query = { resourceId, from: '2026-10-19T00:00:00Z', to: '2026-10-19T00:00:00Z' };
    expect(calendarQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('providerBookingsQuerySchema', () => {
  it('applique les valeurs par défaut', () => {
    expect(providerBookingsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      scope: 'upcoming',
    });
  });

  it('refuse le statut `expired` et une page de plus de 50', () => {
    expect(providerBookingsQuerySchema.safeParse({ status: 'expired' }).success).toBe(false);
    expect(providerBookingsQuerySchema.safeParse({ pageSize: '51' }).success).toBe(false);
  });
});
