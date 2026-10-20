import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Slot, TimeRange } from '@creno/shared';
import { DaySlots } from './slot-chooser';

// Lundi 26 octobre 2026 à Paris (UTC+1) : 10:00, 14:00 (pris), 15:00, 19:00.
const at = (hour: number, available = true): Slot => {
  const start = new Date(Date.UTC(2026, 9, 26, hour - 1)).toISOString();
  return { start, end: start, available };
};
const day = [at(10), at(14, false), at(15), at(19)];

const render = (slots: Slot[], timeRange?: TimeRange) =>
  renderToStaticMarkup(
    createElement(DaySlots, {
      slots,
      timeRange,
      timezone: 'Europe/Paris',
      selectedStart: null,
      onSelect: () => undefined,
    }),
  );
/** Libellés des boutons, dans l'ordre d'affichage. */
const times = (html: string) =>
  [...html.matchAll(/(\d\d:\d\d)<\/(?:button|span)>/g)].map((m) => m[1]);

describe('DaySlots', () => {
  it('sans plage, une seule grille dans l’ordre de la journée', () => {
    const html = render(day);
    expect(html).not.toContain('Votre plage');
    expect(times(html)).toEqual(['10:00', '14:00', '15:00', '19:00']);
  });

  it('avec une plage, « Votre plage » puis « Autres horaires »', () => {
    const html = render(day, { timeFrom: '12:00', timeTo: '18:00' });
    expect(html).toContain('Votre plage : l&#x27;après-midi (12 h – 18 h)');
    expect(html.indexOf('Votre plage')).toBeLessThan(html.indexOf('Autres horaires'));
    // Créneaux de la plage (le pris reste affiché comme tel), puis les autres.
    expect(times(html)).toEqual(['14:00', '15:00', '10:00', '19:00']);
    expect(html.match(/<h3 /g)).toHaveLength(2);
  });

  it('sans créneau libre dans la plage, un message le dit', () => {
    const html = render(day, { timeFrom: '18:00', timeTo: '19:00' });
    expect(html).toContain('Aucun créneau libre entre 18 h et 19 h ce jour.');
    expect(html).toContain('Autres horaires');
  });

  it('« Autres horaires » disparaît quand tout est dans la plage', () => {
    const html = render(day, { timeFrom: '09:00' });
    expect(html).not.toContain('Autres horaires');
    expect(times(html)).toEqual(['10:00', '14:00', '15:00', '19:00']);
  });
});
