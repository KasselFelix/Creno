import { describe, expect, it } from 'vitest';
import { EXAMPLE_JWT_SECRET, loadConfig } from './env.js';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://creno:creno@localhost:5432/creno',
  WEB_ORIGIN: 'http://localhost:3000/',
  JWT_ACCESS_SECRET: EXAMPLE_JWT_SECRET,
};

// Fausses clés construites à l'exécution : aucune chaîne en forme de secret dans le dépôt.
const stripeKey = (mode: 'test' | 'live') => ['sk', mode, 'x'.repeat(24)].join('_');
const webhookSecret = ['whsec', 'x'.repeat(24)].join('_');
const resendKey = ['re', 'x'.repeat(24)].join('_');
const prodBase = { ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(48) };
const prod = {
  ...prodBase,
  STRIPE_SECRET_KEY: stripeKey('live'),
  STRIPE_WEBHOOK_SECRET: webhookSecret,
  RESEND_API_KEY: resendKey,
  EMAIL_FROM: 'Creno <bonjour@creno.test>',
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
    expect(() => loadConfig({ ...prod, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ ...prod, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
  });

  describe('Stripe', () => {
    it('est facultatif hors production, et une variable vide vaut absente', () => {
      const config = loadConfig({ ...base, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
      expect(config.STRIPE_SECRET_KEY).toBeUndefined();
      expect(config.STRIPE_WEBHOOK_SECRET).toBeUndefined();
      expect(config.STRIPE_PLATFORM_FEE_BPS).toBe(1000);
    });

    it('refuse une clé live hors production, sans afficher sa valeur', () => {
      const live = stripeKey('live');
      expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: live })).toThrow(/STRIPE_SECRET_KEY/);
      expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: live })).not.toThrow(new RegExp(live));
      expect(loadConfig({ ...base, STRIPE_SECRET_KEY: stripeKey('test') }).STRIPE_SECRET_KEY).toBe(
        stripeKey('test'),
      );
    });

    it('exige la clé et le secret de webhook en production', () => {
      expect(() => loadConfig(prodBase)).toThrow(/STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET/);
      expect(loadConfig(prod).STRIPE_CONNECT_WEBHOOK_SECRET).toBeUndefined();
    });

    it('borne la commission entre 0 et 50 %', () => {
      expect(loadConfig({ ...base, STRIPE_PLATFORM_FEE_BPS: '0' }).STRIPE_PLATFORM_FEE_BPS).toBe(0);
      expect(() => loadConfig({ ...base, STRIPE_PLATFORM_FEE_BPS: '5001' })).toThrow(
        /STRIPE_PLATFORM_FEE_BPS/,
      );
    });
  });

  describe('notifications', () => {
    it('sont facultatives hors production : rien ne part sans clé', () => {
      const config = loadConfig({ ...base, RESEND_API_KEY: '', MAILPIT_URL: '', TWILIO_FROM: '' });
      expect(config.RESEND_API_KEY).toBeUndefined();
      expect(config.MAILPIT_URL).toBeUndefined();
      expect(config.JOBS_WORKERS_ENABLED).toBe(true);
      expect(loadConfig({ ...base, JOBS_WORKERS_ENABLED: 'false' }).JOBS_WORKERS_ENABLED).toBe(
        false,
      );
    });

    it('exige Resend et refuse Mailpit en production', () => {
      const { RESEND_API_KEY: _omit, ...withoutResend } = prod;
      expect(() => loadConfig(withoutResend)).toThrow(/RESEND_API_KEY/);
      expect(() => loadConfig({ ...prod, MAILPIT_URL: 'http://mailpit:8025' })).toThrow(
        /MAILPIT_URL/,
      );
    });

    it('exige les trois variables Twilio ensemble, sans afficher leur valeur', () => {
      const sid = `AC${'a'.repeat(32)}`;
      const token = 'b'.repeat(32);
      expect(() => loadConfig({ ...base, TWILIO_ACCOUNT_SID: sid })).toThrow(/TWILIO/);
      expect(() => loadConfig({ ...base, TWILIO_ACCOUNT_SID: sid })).not.toThrow(new RegExp(sid));
      const config = loadConfig({
        ...base,
        TWILIO_ACCOUNT_SID: sid,
        TWILIO_AUTH_TOKEN: token,
        TWILIO_FROM: '+33600000000',
      });
      expect(config.TWILIO_FROM).toBe('+33600000000');
    });

    it('refuse l’expéditeur de démonstration de Resend en production', () => {
      for (const from of ['Creno <onboarding@resend.dev>', 'test@Resend.DEV']) {
        expect(() => loadConfig({ ...prod, EMAIL_FROM: from })).toThrow(/EMAIL_FROM/);
      }
    });

    it('limite les SMS aux mobiles français par défaut', () => {
      expect(loadConfig(base).SMS_ALLOWED_PREFIXES).toEqual(['+336', '+337']);
      expect(
        loadConfig({ ...base, SMS_ALLOWED_PREFIXES: '+32,+336' }).SMS_ALLOWED_PREFIXES,
      ).toEqual(['+32', '+336']);
      expect(() => loadConfig({ ...base, SMS_ALLOWED_PREFIXES: 'tous' })).toThrow(
        /SMS_ALLOWED_PREFIXES/,
      );
    });

    it('valide l’expéditeur des emails', () => {
      expect(loadConfig(base).EMAIL_FROM).toBe('Creno <onboarding@resend.dev>');
      expect(() => loadConfig({ ...base, EMAIL_FROM: 'pas une adresse' })).toThrow(/EMAIL_FROM/);
    });
  });

  it('interprète TRUST_PROXY', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'loopback' }).TRUST_PROXY).toBe('loopback');
  });
});
