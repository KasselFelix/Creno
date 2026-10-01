import { describe, expect, it } from 'vitest';
import {
  computeSlots,
  isOfferedSlot,
  localDateOf,
  type SlotsInput,
  wallTimeToInstant,
} from './slots.engine.js';

const PARIS = 'Europe/Paris';
const MINUTE = 60_000;

const allWeek = (startTime: string, endTime: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime, endTime }));

function input(patch: Partial<SlotsInput>): SlotsInput {
  return {
    timezone: PARIS,
    slotMinutes: 60,
    rules: allWeek('09:00', '12:00'),
    closures: [],
    busy: [],
    from: '2026-10-05',
    to: '2026-10-05',
    now: new Date('2026-10-01T00:00:00Z'),
    horizonDays: 90,
    ...patch,
  };
}

const starts = (patch: Partial<SlotsInput>) =>
  computeSlots(input(patch)).flatMap((day) => day.slots.map((slot) => slot.start.toISOString()));

/** Écarts en minutes réelles entre deux débuts de créneau consécutifs. */
const gaps = (isoStarts: string[]) =>
  isoStarts.slice(1).map((iso, i) => (Date.parse(iso) - Date.parse(isoStarts[i]!)) / MINUTE);

describe('wallTimeToInstant', () => {
  it('convertit une heure locale selon le décalage du jour (été puis hiver à Paris)', () => {
    expect(wallTimeToInstant('2026-10-05', '09:00', PARIS).toISOString()).toBe(
      '2026-10-05T07:00:00.000Z',
    );
    expect(wallTimeToInstant('2026-11-02', '09:00', PARIS).toISOString()).toBe(
      '2026-11-02T08:00:00.000Z',
    );
  });

  it('24:00 est le début du lendemain, pas « + 24 h » (jour de 25 h)', () => {
    expect(wallTimeToInstant('2026-10-25', '24:00', PARIS).toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    );
  });

  it("décale vers l'avant une heure inexistante (passage à l'heure d'été)", () => {
    // 02:30 n'existe pas le 28 mars 2027 à Paris : on obtient 03:30 heure d'été.
    expect(wallTimeToInstant('2027-03-28', '02:30', PARIS).toISOString()).toBe(
      '2027-03-28T01:30:00.000Z',
    );
  });

  it("prend la première occurrence d'une heure répétée (passage à l'heure d'hiver)", () => {
    // 02:30 existe deux fois le 25 octobre 2026 : 00:30Z (été) puis 01:30Z (hiver).
    expect(wallTimeToInstant('2026-10-25', '02:30', PARIS).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
});

describe('localDateOf', () => {
  it('donne le jour local de la ressource, pas le jour UTC', () => {
    const instant = new Date('2026-10-05T23:30:00Z');
    expect(localDateOf(instant, PARIS)).toBe('2026-10-06');
    expect(localDateOf(instant, 'America/New_York')).toBe('2026-10-05');
  });
});

describe('computeSlots', () => {
  it('découpe la plage du jour en créneaux [début, fin) de la durée de la ressource', () => {
    const [day] = computeSlots(input({}));
    expect(day!.date).toBe('2026-10-05');
    expect(day!.slots).toEqual([
      {
        start: new Date('2026-10-05T07:00:00Z'),
        end: new Date('2026-10-05T08:00:00Z'),
        available: true,
      },
      {
        start: new Date('2026-10-05T08:00:00Z'),
        end: new Date('2026-10-05T09:00:00Z'),
        available: true,
      },
      {
        start: new Date('2026-10-05T09:00:00Z'),
        end: new Date('2026-10-05T10:00:00Z'),
        available: true,
      },
    ]);
  });

  it("n'applique que les règles du jour de la semaine (ISO : 1 = lundi)", () => {
    const rules = [{ weekday: 2, startTime: '09:00', endTime: '10:00' }];
    const days = computeSlots(input({ rules, from: '2026-10-05', to: '2026-10-07' }));
    expect(days.map((d) => [d.date, d.slots.length])).toEqual([
      ['2026-10-05', 0],
      ['2026-10-06', 1],
      ['2026-10-07', 0],
    ]);
  });

  it('abandonne le reste trop court en fin de plage', () => {
    const rules = allWeek('09:00', '10:45');
    expect(starts({ rules, slotMinutes: 30 })).toHaveLength(3);
  });

  it('gère plusieurs plages le même jour et une fin à 24:00', () => {
    const rules = [
      { weekday: 1, startTime: '22:00', endTime: '24:00' },
      { weekday: 1, startTime: '09:00', endTime: '10:00' },
    ];
    expect(starts({ rules })).toEqual([
      '2026-10-05T07:00:00.000Z',
      '2026-10-05T20:00:00.000Z',
      '2026-10-05T21:00:00.000Z',
    ]);
  });

  describe("changements d'heure", () => {
    const night = allWeek('00:00', '08:00');

    it("jour de 25 h (25 octobre 2026) : un créneau de plus, l'heure répétée proposée deux fois", () => {
      const normal = starts({ rules: night, from: '2026-10-18', to: '2026-10-18' });
      const fallBack = starts({ rules: night, from: '2026-10-25', to: '2026-10-25' });
      expect(normal).toHaveLength(8);
      expect(fallBack).toHaveLength(9);
      expect(fallBack[0]).toBe('2026-10-24T22:00:00.000Z');
      // 02:00 heure d'été puis 02:00 heure d'hiver : deux instants distincts.
      expect(fallBack).toContain('2026-10-25T00:00:00.000Z');
      expect(fallBack).toContain('2026-10-25T01:00:00.000Z');
      expect(new Set(fallBack).size).toBe(fallBack.length);
      expect(gaps(fallBack).every((gap) => gap === 60)).toBe(true);
    });

    it("jour de 23 h (28 mars 2027) : un créneau de moins, aucun sur l'heure inexistante", () => {
      const now = new Date('2027-03-01T00:00:00Z');
      const springForward = starts({ rules: night, from: '2027-03-28', to: '2027-03-28', now });
      expect(springForward).toHaveLength(7);
      expect(springForward.slice(0, 3)).toEqual([
        '2027-03-27T23:00:00.000Z', // 00:00 heure d'hiver
        '2027-03-28T00:00:00.000Z', // 01:00 heure d'hiver
        '2027-03-28T01:00:00.000Z', // 03:00 heure d'été
      ]);
      expect(gaps(springForward).every((gap) => gap === 60)).toBe(true);
    });

    it("une plage qui commence sur l'heure inexistante démarre après le saut", () => {
      const now = new Date('2027-03-01T00:00:00Z');
      const rules = allWeek('02:30', '05:30');
      expect(starts({ rules, from: '2027-03-28', to: '2027-03-28', now })).toEqual([
        '2027-03-28T01:30:00.000Z', // 03:30 heure d'été
        '2027-03-28T02:30:00.000Z',
      ]);
    });

    it('un fuseau sans changement d’heure garde le même nombre de créneaux', () => {
      const tokyo = { rules: night, timezone: 'Asia/Tokyo' };
      expect(starts({ ...tokyo, from: '2026-10-25', to: '2026-10-25' })).toHaveLength(8);
      expect(starts({ ...tokyo, from: '2026-10-18', to: '2026-10-18' })).toHaveLength(8);
    });

    it("à l'ouest d'UTC, les créneaux du soir restent rattachés au jour local", () => {
      const rules = [{ weekday: 1, startTime: '22:00', endTime: '24:00' }];
      const [day] = computeSlots(input({ rules, timezone: 'America/New_York' }));
      expect(day!.date).toBe('2026-10-05');
      expect(day!.slots.map((s) => s.start.toISOString())).toEqual([
        '2026-10-06T02:00:00.000Z',
        '2026-10-06T03:00:00.000Z',
      ]);
    });
  });

  it('retire les créneaux qui chevauchent une fermeture, même partiellement', () => {
    const closures = [
      { start: new Date('2026-10-05T07:30:00Z'), end: new Date('2026-10-05T08:00:00Z') },
    ];
    expect(starts({ closures })).toEqual(['2026-10-05T08:00:00.000Z', '2026-10-05T09:00:00.000Z']);
  });

  it('une fermeture qui se termine au début du créneau ne le retire pas (bornes [))', () => {
    const closures = [
      { start: new Date('2026-10-05T06:00:00Z'), end: new Date('2026-10-05T07:00:00Z') },
    ];
    expect(starts({ closures })).toHaveLength(3);
  });

  it('marque available: false les créneaux occupés, sans toucher aux créneaux adjacents', () => {
    const busy = [
      { start: new Date('2026-10-05T08:00:00Z'), end: new Date('2026-10-05T09:00:00Z') },
    ];
    const [day] = computeSlots(input({ busy }));
    expect(day!.slots.map((s) => s.available)).toEqual([true, false, true]);
  });

  it('une réservation posée sur une ancienne grille bloque tous les créneaux qu’elle chevauche', () => {
    // Réservation 09:30-10:30 (heure locale) prise quand la ressource avait des créneaux décalés.
    const busy = [
      { start: new Date('2026-10-05T07:30:00Z'), end: new Date('2026-10-05T08:30:00Z') },
    ];
    const [day] = computeSlots(input({ busy }));
    expect(day!.slots.map((s) => s.available)).toEqual([false, false, true]);
  });

  it('ne propose pas les créneaux déjà commencés', () => {
    const now = new Date('2026-10-05T08:00:00Z');
    expect(starts({ now })).toEqual(['2026-10-05T09:00:00.000Z']);
  });

  it("s'arrête à l'horizon, compté en jours calendaires locaux", () => {
    // 1er octobre 23:30 à Paris : l'horizon de 90 jours couvre jusqu'au 30 décembre inclus.
    const now = new Date('2026-10-01T21:30:00Z');
    const days = computeSlots(input({ now, from: '2026-12-30', to: '2026-12-31' }));
    expect(days.map((d) => d.slots.length)).toEqual([3, 0]);
  });
});

describe('isOfferedSlot', () => {
  const base = input({});

  it('reconnaît un début de créneau de la grille', () => {
    expect(isOfferedSlot(base, new Date('2026-10-05T08:00:00Z'))).toBe(true);
  });

  it.each([
    ['hors grille', '2026-10-05T08:30:00Z'],
    ['hors horaires', '2026-10-05T12:00:00Z'],
    ['au-delà de l’horizon', '2027-06-07T08:00:00Z'],
  ])('refuse un début %s', (_label, iso) => {
    expect(isOfferedSlot(base, new Date(iso))).toBe(false);
  });

  it('refuse un créneau passé ou fermé, mais ignore les réservations', () => {
    const start = new Date('2026-10-05T08:00:00Z');
    const end = new Date('2026-10-05T09:00:00Z');
    expect(isOfferedSlot({ ...base, now: start }, start)).toBe(false);
    expect(isOfferedSlot({ ...base, closures: [{ start, end }] }, start)).toBe(false);
    expect(isOfferedSlot({ ...base, busy: [{ start, end }] }, start)).toBe(true);
  });
});
