import { describe, expect, it } from 'vitest';
import { isStatusCardClosed } from './status-card-dismissal';

describe('isStatusCardClosed', () => {
  it("reste fermée tant que l'état est celui affiché à la fermeture", () => {
    expect(isStatusCardClosed('up', 'up')).toBe(true);
    expect(isStatusCardClosed('down', 'down')).toBe(true);
  });

  it("réapparaît quand l'état change ou si elle n'a jamais été fermée", () => {
    expect(isStatusCardClosed('up', 'down')).toBe(false);
    expect(isStatusCardClosed('down', 'up')).toBe(false);
    expect(isStatusCardClosed(null, 'up')).toBe(false);
  });
});
