import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, generateNonce } from './csp';

const directive = (policy: string, name: string) =>
  policy.split('; ').find((part) => part.startsWith(`${name} `));

describe('contentSecurityPolicy', () => {
  it('autorise les scripts par nonce seulement, en production', () => {
    const policy = contentSecurityPolicy('abc', { dev: false });
    expect(directive(policy, 'script-src')).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).not.toContain('unsafe-eval');
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it('ouvre Mapbox (tuiles, workers) sans domaine Sentry', () => {
    const policy = contentSecurityPolicy('abc', { dev: false });
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' https://*.mapbox.com");
    expect(directive(policy, 'worker-src')).toBe("worker-src 'self' blob:");
    expect(policy).not.toContain('sentry');
  });

  it('autorise eval et le websocket du rechargement à chaud en dev', () => {
    const policy = contentSecurityPolicy('abc', { dev: true });
    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'connect-src')).toContain('ws:');
    expect(policy).not.toContain('upgrade-insecure-requests');
  });
});

describe('generateNonce', () => {
  it('produit une valeur différente à chaque requête', () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(nonce);
  });
});
