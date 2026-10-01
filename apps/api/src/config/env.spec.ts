import { describe, expect, it } from 'vitest';
import { EXAMPLE_JWT_SECRET, loadConfig } from './env.js';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://creno:creno@localhost:5432/creno',
  WEB_ORIGIN: 'http://localhost:3000/',
  JWT_ACCESS_SECRET: EXAMPLE_JWT_SECRET,
};

describe('loadConfig', () => {
  it('accepte la config de dev et normalise WEB_ORIGIN', () => {
    const config = loadConfig(base);
    expect(config.WEB_ORIGIN).toBe('http://localhost:3000');
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('refuse le secret JWT d’exemple en production, sans afficher sa valeur', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).not.toThrow(
      new RegExp(EXAMPLE_JWT_SECRET),
    );
  });

  it('exige NODE_ENV et un secret d’au moins 32 caractères', () => {
    const { NODE_ENV: _omit, ...withoutEnv } = base;
    expect(() => loadConfig(withoutEnv)).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'court' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuse TRUST_PROXY=true en production (X-Forwarded-For falsifiable)', () => {
    const prod = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(48) };
    expect(() => loadConfig({ ...prod, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ ...prod, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
  });

  it('interprète TRUST_PROXY', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'loopback' }).TRUST_PROXY).toBe('loopback');
  });
});
