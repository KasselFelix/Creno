import { describe, expect, it } from 'vitest';
import type { ProviderBooking } from '@creno/shared';
import {
  businessHoursOf,
  calendarEvents,
  earliestStart,
  mondayOf,
  overlappingBookings,
  snapMinutes,
  wallTimeOf,
} from './calendar';

const booking = (overrides: Partial<ProviderBooking> = {}): ProviderBooking => ({
  id: '3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a11',
  resourceId: '3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a12',
  start: '2026-10-20T08:00:00.000Z',
  end: '2026-10-20T09:00:00.000Z',
  status: 'confirmed',
  expiresAt: null,
  priceCents: 4500,
  currency: 'EUR',
  resourceName: 'Studio A',
  timezone: 'Europe/Paris',
  customer: { fullName: 'Camille Martin', email: 'camille@test.dev' },
  paymentStatus: 'succeeded',
  rescheduledAt: null,
  cancellableUntil: '2026-10-20T08:00:00.000Z',
  reschedulable: true,
  ...overrides,
});

describe('snapMinutes', () => {
  it('le pas tombe sur tous les débuts de créneau', () => {
    expect(snapMinutes(60, [{ startTime: '09:00' }])).toBe(60);
    expect(snapMinutes(60, [{ startTime: '09:00' }, { startTime: '13:30' }])).toBe(30);
    expect(snapMinutes(45, [{ startTime: '09:15' }])).toBe(15);
    expect(snapMinutes(30, [])).toBe(30);
  });
});

describe('earliestStart et businessHoursOf', () => {
  it('premier horaire de la semaine, dimanche en 0 pour FullCalendar', () => {
    const rules = [
      { weekday: 7, startTime: '10:00', endTime: '24:00' },
      { weekday: 1, startTime: '08:30', endTime: '12:00' },
    ];
    expect(earliestStart(rules)).toBe('08:30:00');
    expect(earliestStart([])).toBe('08:00:00');
    expect(businessHoursOf(rules)).toEqual([
      { daysOfWeek: [0], startTime: '10:00', endTime: '24:00' },
      { daysOfWeek: [1], startTime: '08:30', endTime: '12:00' },
    ]);
  });
});

describe('mondayOf', () => {
  it.each([
    ['2026-10-19', '2026-10-19'],
    ['2026-10-25', '2026-10-19'],
    ['2026-10-21', '2026-10-19'],
    ['2026-11-01', '2026-10-26'],
  ])('%s → %s', (date, monday) => {
    expect(mondayOf(date)).toBe(monday);
  });
});

describe('wallTimeOf', () => {
  it('garde l’heure locale du fuseau du calendrier', () => {
    expect(wallTimeOf('2026-10-20T10:00:00+02:00')).toBe('2026-10-20T10:00');
  });
});

describe('overlappingBookings', () => {
  it('compte les réservations confirmées qui chevauchent la plage, bornes [début, fin)', () => {
    const items = [
      booking(),
      booking({ start: '2026-10-20T09:00:00.000Z', end: '2026-10-20T10:00:00.000Z' }),
      booking({ status: 'pending' }),
    ];
    expect(
      overlappingBookings(
        items,
        new Date('2026-10-20T08:30:00.000Z'),
        new Date('2026-10-20T09:00:00.000Z'),
      ),
    ).toBe(1);
  });
});

describe('calendarEvents', () => {
  it('une réservation se déplace si l’API le permet, un hold est anonyme et grisé', () => {
    const events = calendarEvents(
      [booking(), booking({ status: 'pending', customer: null, reschedulable: false })],
      [
        {
          id: '3f0c2f0e-6a52-4d53-9a5e-1f7f6f0c9a13',
          start: '2026-10-21T07:00:00.000Z',
          end: '2026-10-21T10:00:00.000Z',
          reason: 'Travaux',
        },
      ],
    );
    expect(
      events.map((event) => [
        event.title,
        'editable' in event ? event.editable : event.startEditable,
      ]),
    ).toEqual([
      ['Fermé · Travaux', false],
      ['Camille Martin', true],
      ['Paiement en cours', false],
    ]);
    expect(events[2]).toMatchObject({ color: 'var(--muted)' });
  });
});
