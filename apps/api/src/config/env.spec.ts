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

  it('interprète TRUST_PROXY', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'loopback' }).TRUST_PROXY).toBe('loopback');
  });
});
