import { describe, expect, it } from 'vitest';
import {
  createExceptionSchema,
  createResourceSchema,
  isValidTimeZone,
  replaceRulesSchema,
  slotsQuerySchema,
} from './index.js';

describe('replaceRulesSchema', () => {
  const rule = (weekday: number, startTime: string, endTime: string) => ({
    weekday,
    startTime,
    endTime,
  });

  it('accepte des plages qui se touchent et une fin à 24:00', () => {
    const rules = [rule(1, '09:00', '12:00'), rule(1, '12:00', '24:00'), rule(2, '09:00', '12:00')];
    expect(replaceRulesSchema.safeParse({ rules }).success).toBe(true);
  });

  it.each([
    ['chevauchement le même jour', [rule(1, '09:00', '12:00'), rule(1, '11:00', '14:00')]],
    ['fin avant le début', [rule(1, '12:00', '09:00')]],
    ['plage vide', [rule(1, '09:00', '09:00')]],
    ['début à 24:00', [rule(1, '24:00', '24:00')]],
    ['jour hors 1..7', [rule(0, '09:00', '12:00')]],
    ['heure mal formée', [rule(1, '9:00', '12:00')]],
  ])('refuse : %s', (_label, rules) => {
    expect(replaceRulesSchema.safeParse({ rules }).success).toBe(false);
  });
});

describe('slotsQuerySchema', () => {
  it('accepte 31 jours et refuse 32, une plage inversée ou une date impossible', () => {
    expect(slotsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(slotsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-01' }).success).toBe(
      false,
    );
    expect(slotsQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(slotsQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(
      false,
    );
  });
});

describe('createExceptionSchema', () => {
  it('exige une fin après le début', () => {
    const base = { startLocal: '2026-10-05T09:00', endLocal: '2026-10-05T12:00' };
    expect(createExceptionSchema.safeParse(base).success).toBe(true);
    expect(createExceptionSchema.safeParse({ ...base, endLocal: '2026-10-05T09:00' }).success).toBe(
      false,
    );
  });
});

describe('fuseau horaire', () => {
  it('accepte un fuseau IANA et refuse abréviations, décalages et inconnus', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('EST')).toBe(false);
    expect(isValidTimeZone('+01:00')).toBe(false);
    expect(isValidTimeZone('Europe/Atlantide')).toBe(false);
  });

  it('borne la durée du créneau dans createResourceSchema', () => {
    const base = {
      name: 'Studio',
      description: '',
      timezone: 'Europe/Paris',
      slotMinutes: 60,
      priceCents: 4500,
    };
    expect(createResourceSchema.safeParse(base).success).toBe(true);
    expect(createResourceSchema.safeParse({ ...base, slotMinutes: 4 }).success).toBe(false);
    expect(createResourceSchema.safeParse({ ...base, priceCents: -1 }).success).toBe(false);
  });
});
