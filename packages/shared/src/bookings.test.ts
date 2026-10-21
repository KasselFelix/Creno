import { describe, expect, it } from 'vitest';
import {
  calendarQuerySchema,
  cancelBookingSchema,
  customerRefundSteps,
  providerBookingsQuerySchema,
  refundCentsFor,
  refundPolicyText,
  refundStepAt,
} from './index.js';

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

const HOUR = 60 * 60 * 1000;
const start = new Date('2026-10-30T09:00:00Z');
const hoursBefore = (hours: number) => new Date(start.getTime() - hours * HOUR);

describe('customerRefundSteps', () => {
  it('trois paliers : intégral jusqu’à 48 h avant, 50 % jusqu’à 24 h avant, puis aucun', () => {
    expect(customerRefundSteps({ start, rescheduledAt: null })).toEqual([
      { percent: 100, until: hoursBefore(48) },
      { percent: 50, until: hoursBefore(24) },
      { percent: 0, until: start },
    ]);
  });

  it('accepte des dates ISO (détail de l’API)', () => {
    expect(customerRefundSteps({ start: start.toISOString(), rescheduledAt: null })).toEqual(
      customerRefundSteps({ start, rescheduledAt: null }),
    );
  });

  it('déplacée 4 jours avant : la règle habituelle', () => {
    const steps = customerRefundSteps({ start, rescheduledAt: hoursBefore(96) });
    expect(steps).toEqual(customerRefundSteps({ start, rescheduledAt: null }));
  });

  it('déplacée 40 h avant : 24 h de remboursement intégral, puis aucun (palier à 50 % absorbé)', () => {
    expect(customerRefundSteps({ start, rescheduledAt: hoursBefore(40) })).toEqual([
      { percent: 100, until: hoursBefore(16) },
      { percent: 0, until: start },
    ]);
  });

  it('déplacée 30 h avant : intégral jusqu’à 6 h avant, puis aucun', () => {
    expect(customerRefundSteps({ start, rescheduledAt: hoursBefore(30) })).toEqual([
      { percent: 100, until: hoursBefore(6) },
      { percent: 0, until: start },
    ]);
  });

  it('déplacée 10 h avant : intégral jusqu’au début, sans dépasser', () => {
    expect(customerRefundSteps({ start, rescheduledAt: hoursBefore(10) })).toEqual([
      { percent: 100, until: start },
    ]);
  });

  it('déplacée 60 h avant : intégral jusqu’à 36 h avant, puis 50 % jusqu’à 24 h avant', () => {
    expect(customerRefundSteps({ start, rescheduledAt: hoursBefore(60) })).toEqual([
      { percent: 100, until: hoursBefore(36) },
      { percent: 50, until: hoursBefore(24) },
      { percent: 0, until: start },
    ]);
  });
});

describe('refundStepAt', () => {
  const steps = customerRefundSteps({ start, rescheduledAt: null });

  it('seuils exacts : l’échéance d’un palier ouvre le suivant', () => {
    expect(refundStepAt(steps, hoursBefore(72))?.percent).toBe(100);
    expect(refundStepAt(steps, new Date(hoursBefore(48).getTime() - 1))?.percent).toBe(100);
    expect(refundStepAt(steps, hoursBefore(48))?.percent).toBe(50);
    expect(refundStepAt(steps, hoursBefore(24))?.percent).toBe(0);
    expect(refundStepAt(steps, new Date(start.getTime() - 1))?.percent).toBe(0);
  });

  it('créneau commencé : plus de palier', () => {
    expect(refundStepAt(steps, start)).toBeNull();
    expect(refundStepAt(steps, hoursBefore(-1))).toBeNull();
  });
});

describe('refundCentsFor', () => {
  it('arrondit au centime inférieur', () => {
    expect(refundCentsFor(4500, 100)).toBe(4500);
    expect(refundCentsFor(4500, 50)).toBe(2250);
    expect(refundCentsFor(4501, 50)).toBe(2250);
    expect(refundCentsFor(4500, 0)).toBe(0);
  });
});

describe('refundPolicyText', () => {
  const steps = customerRefundSteps({ start, rescheduledAt: null });
  const format = (date: Date) => date.toISOString().slice(0, 16);

  it('liste les paliers à venir', () => {
    expect(refundPolicyText(steps, hoursBefore(72), format)).toBe(
      "Annulation gratuite jusqu'au 2026-10-28T09:00, remboursée à 50 % jusqu'au 2026-10-29T09:00, puis sans remboursement.",
    );
  });

  it('réservation prise tard : seulement les paliers qui restent', () => {
    expect(refundPolicyText(steps, hoursBefore(30), format)).toBe(
      "Annulation remboursée à 50 % jusqu'au 2026-10-29T09:00, puis sans remboursement.",
    );
    expect(refundPolicyText(steps, hoursBefore(10), format)).toBe(
      'Annulation sans remboursement (moins de 24 h avant le début).',
    );
  });

  it('déplacée près du début : intégral jusqu’au début', () => {
    const moved = customerRefundSteps({ start, rescheduledAt: hoursBefore(10) });
    expect(refundPolicyText(moved, hoursBefore(9), format)).toBe(
      "Annulation gratuite jusqu'au 2026-10-30T09:00.",
    );
  });

  it('créneau commencé : rien', () => {
    expect(refundPolicyText(steps, start, format)).toBeNull();
  });
});

describe('cancelBookingSchema', () => {
  it('accepte un corps absent (prestataire, Express 5 sans `req.body`)', () => {
    expect(cancelBookingSchema.parse(undefined)).toEqual({});
  });

  it('refuse un montant négatif ou décimal', () => {
    expect(cancelBookingSchema.safeParse({ expectedRefundCents: -1 }).success).toBe(false);
    expect(cancelBookingSchema.safeParse({ expectedRefundCents: 12.5 }).success).toBe(false);
    expect(cancelBookingSchema.parse({ expectedRefundCents: 2250 })).toEqual({
      expectedRefundCents: 2250,
    });
  });
});
