import { describe, expect, it } from 'vitest';
import { buildSlotGrid, GRID_DAYS, pickHomeBackground, SLOT_HOURS } from './background';

describe('pickHomeBackground', () => {
  it('tire le globe ou la grille à 50/50', () => {
    expect(pickHomeBackground(() => 0.2)).toBe('globe');
    expect(pickHomeBackground(() => 0.7)).toBe('grid');
    expect(pickHomeBackground(() => 0.5)).toBe('grid');
  });

  it('obéit au paramètre `fond` sans tirer au sort', () => {
    const random = () => {
      throw new Error('pas de tirage');
    };
    expect(pickHomeBackground(random, 'globe')).toBe('globe');
    expect(pickHomeBackground(random, 'grille')).toBe('grid');
  });

  it('tire au sort quand `fond` est absent ou inconnu', () => {
    expect(pickHomeBackground(() => 0.2, null)).toBe('globe');
    expect(pickHomeBackground(() => 0.7, 'aurore')).toBe('grid');
  });
});

describe('buildSlotGrid', () => {
  it('couvre deux semaines à partir du lundi de la semaine', () => {
    // Mercredi 21 octobre 2026 → lundi 19.
    const grid = buildSlotGrid('2026-10-21', 1);
    expect(grid.days).toHaveLength(GRID_DAYS);
    expect(grid.days[0]).toEqual({ date: '2026-10-19', label: 'lun. 19' });
    expect(grid.days[13]).toEqual({ date: '2026-11-01', label: 'dim. 1' });
  });

  it('couvre une seule semaine sur demande (écran étroit), du lundi au dimanche', () => {
    const grid = buildSlotGrid('2026-10-21', 1, 7);
    expect(grid.days.map((day) => day.label)).toEqual([
      'lun. 19',
      'mar. 20',
      'mer. 21',
      'jeu. 22',
      'ven. 23',
      'sam. 24',
      'dim. 25',
    ]);
    for (const row of grid.rows) expect(row.cells).toHaveLength(7);
  });

  it("part du jour même quand c'est un lundi, et de la veille du dimanche suivant", () => {
    expect(buildSlotGrid('2026-10-26', 1).days[0]!.date).toBe('2026-10-26');
    expect(buildSlotGrid('2026-11-01', 1).days[0]!.date).toBe('2026-10-26');
  });

  it('donne une rangée par heure, une case par jour, avec une heure de créneau', () => {
    const grid = buildSlotGrid('2026-10-21', 1);
    expect(grid.rows.map((row) => row.label)).toEqual(SLOT_HOURS.map((hour) => `${hour} h`));
    for (const row of grid.rows) {
      expect(row.cells).toHaveLength(GRID_DAYS);
      for (const cell of row.cells) {
        expect(cell.time).toMatch(new RegExp(`^${String(row.hour).padStart(2, '0')}:(00|30)$`));
      }
    }
  });

  it('prend quelques créneaux, davantage le week-end', () => {
    const cells = buildSlotGrid('2026-10-21', 7).rows.flatMap((row) =>
      row.cells.map((cell, day) => ({ ...cell, weekend: day % 7 >= 5 })),
    );
    const share = (list: typeof cells) => list.filter((cell) => cell.taken).length / list.length;
    const week = cells.filter((cell) => !cell.weekend);
    const weekend = cells.filter((cell) => cell.weekend);
    expect(share(week)).toBeGreaterThan(0);
    expect(share(week)).toBeLessThan(0.4);
    expect(share(weekend)).toBeGreaterThan(share(week));
  });

  it('rend la même grille pour la même graine', () => {
    expect(buildSlotGrid('2026-10-21', 42)).toEqual(buildSlotGrid('2026-10-21', 42));
    expect(buildSlotGrid('2026-10-21', 42)).not.toEqual(buildSlotGrid('2026-10-21', 43));
  });
});
