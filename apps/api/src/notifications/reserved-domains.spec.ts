import { describe, expect, it } from 'vitest';
import { isReservedEmailDomain } from './reserved-domains.js';

describe('isReservedEmailDomain', () => {
  it.each([
    'lea.petit@example.com',
    'a@EXAMPLE.org',
    'a@mail.example.net',
    'a@creno.test',
    'a@foo.invalid',
    'a@host.localhost',
    'a@demo.example',
  ])('%s : aucun envoi', (email) => {
    expect(isReservedEmailDomain(email)).toBe(true);
  });

  it.each(['lea@gmail.com', 'a@example.com.fr', 'a@notexample.com', 'a@test.dev'])(
    '%s : envoi normal',
    (email) => {
      expect(isReservedEmailDomain(email)).toBe(false);
    },
  );
});
