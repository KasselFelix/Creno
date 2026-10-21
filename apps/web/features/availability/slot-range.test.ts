import { describe, expect, it } from 'vitest';
import type { Slot } from '@creno/shared';
import { parseSlotRange, splitSlotsByRange } from './slot-range';

const slot = (start: string): Slot => ({ start, end: start, available: true });
const starts = (slots: Slot[]) => slots.map((item) => item.start);

describe('parseSlotRange', () => {
  it("lit la plage d'un résultat de recherche", () => {
    expect(parseSlotRange({ timeFrom: '12:00', timeTo: '18:00' })).toEqual({
      timeFrom: '12:00',
      timeTo: '18:00',
    });
    expect(parseSlotRange({ timeFrom: '18:00' })).toEqual({ timeFrom: '18:00' });
    expect(parseSlotRange({ timeTo: '12:00' })).toEqual({ timeTo: '12:00' });
  });

  it('ignore une borne invalide et garde l’autre', () => {
    expect(parseSlotRange({ timeFrom: '25:00', timeTo: '12:00' })).toEqual({ timeTo: '12:00' });
    expect(parseSlotRange({ timeFrom: ['12:00', '13:00'], timeTo: '18:00' })).toEqual({
      timeTo: '18:00',
    });
  });

  it('sans plage utile, la fiche reste sans plage', () => {
    expect(parseSlotRange({})).toBeUndefined();
    expect(parseSlotRange({ timeFrom: 'midi' })).toBeUndefined();
    // Inversée, ou bornes neutres (toute la journée).
    expect(parseSlotRange({ timeFrom: '18:00', timeTo: '12:00' })).toBeUndefined();
    expect(parseSlotRange({ timeFrom: '00:00', timeTo: '24:00' })).toBeUndefined();
  });
});

describe('splitSlotsByRange', () => {
  // Lundi 26 octobre 2026, Paris en heure d'hiver (UTC+1).
  const day = ['08:00', '10:30', '11:00', '17:30', '18:00'].map((time) => {
    const [hours, minutes] = time.split(':').map(Number) as [number, number];
    return slot(new Date(Date.UTC(2026, 9, 26, hours - 1, minutes)).toISOString());
  });

  it('classe par heure de début locale, fin de plage exclue (comme la recherche)', () => {
    const { inRange, others } = splitSlotsByRange(
      day,
      { timeFrom: '11:00', timeTo: '18:00' },
      'Europe/Paris',
    );
    expect(starts(inRange)).toEqual([day[2]!.start, day[3]!.start]);
    expect(starts(others)).toEqual([day[0]!.start, day[1]!.start, day[4]!.start]);
  });

  it('accepte une seule borne (matin, soir)', () => {
    expect(splitSlotsByRange(day, { timeTo: '12:00' }, 'Europe/Paris').inRange).toHaveLength(3);
    expect(splitSlotsByRange(day, { timeFrom: '18:00' }, 'Europe/Paris').inRange).toHaveLength(1);
  });

  it('utilise le fuseau de la ressource, pas celui du navigateur', () => {
    // New York est à UTC-4 le 26 octobre : 10:30 à Paris = 5:30, 11:00 = 6:00 (borne exclue).
    const { inRange } = splitSlotsByRange(day, { timeTo: '06:00' }, 'America/New_York');
    expect(starts(inRange)).toEqual([day[0]!.start, day[1]!.start]);
  });

  it("le jour du passage à l'heure d'hiver, les deux 2 h 30 sont dans la plage", () => {
    // 25 octobre 2026 : 2 h 30 existe deux fois à Paris (UTC+2, puis UTC+1).
    const twice = [slot('2026-10-25T00:30:00Z'), slot('2026-10-25T01:30:00Z')];
    const late = slot('2026-10-25T02:00:00Z'); // 3 h 00, heure d'hiver
    const { inRange, others } = splitSlotsByRange(
      [...twice, late],
      { timeFrom: '02:00', timeTo: '03:00' },
      'Europe/Paris',
    );
    expect(starts(inRange)).toEqual(starts(twice));
    expect(starts(others)).toEqual([late.start]);
  });
});
