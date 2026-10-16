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
const twilio = {
  TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'b'.repeat(32),
  TWILIO_FROM: '+33600000000',
};
const prodBase = {
  ...base,
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  TRUST_PROXY: '1',
  CLIENT_IP_SECRET: 'c'.repeat(40),
};
const prod = {
  ...prodBase,
  ...twilio,
  STRIPE_SECRET_KEY: stripeKey('live'),
  STRIPE_WEBHOOK_SECRET: webhookSecret,
  STRIPE_CONNECT_WEBHOOK_SECRET: webhookSecret,
  RESEND_API_KEY: resendKey,
  EMAIL_FROM: 'Creno <bonjour@creno.test>',
};
// Démo publique : clé de test, sans Twilio.
const {
  TWILIO_ACCOUNT_SID: _sid,
  TWILIO_AUTH_TOKEN: _token,
  TWILIO_FROM: _from,
  ...prodNoTwilio
} = prod;
const demo = { ...prodNoTwilio, DEMO_MODE: 'true', STRIPE_SECRET_KEY: stripeKey('test') };

describe('loadConfig : recherche en langage naturel', () => {
  // Fausse clé construite à l'exécution, comme les autres.
  const mistralKey = 'k'.repeat(32);

  it('démarre sans clé Mistral, avec les valeurs par défaut', () => {
    const config = loadConfig(base);
    expect(config.MISTRAL_API_KEY).toBeUndefined();
    expect(config).toMatchObject({
      AI_MODEL: 'ministral-8b-2512',
      AI_TIMEOUT_MS: 3000,
      AI_RATE_LIMIT_PER_MINUTE: 10,
      AI_DAILY_REQUEST_CAP: 500,
    });
  });

  it('accepte une clé et un plafond à 0 (IA coupée), même en production', () => {
    expect(loadConfig({ ...base, MISTRAL_API_KEY: mistralKey }).MISTRAL_API_KEY).toBe(mistralKey);
    expect(loadConfig({ ...prod, AI_DAILY_REQUEST_CAP: '0' }).AI_DAILY_REQUEST_CAP).toBe(0);
  });

  it.each([
    ['clé trop courte', { MISTRAL_API_KEY: 'court' }, /MISTRAL_API_KEY/],
    ['modèle mal formé', { AI_MODEL: 'Mistral Small' }, /AI_MODEL/],
    ['timeout trop court', { AI_TIMEOUT_MS: '50' }, /AI_TIMEOUT_MS/],
    ['timeout trop long', { AI_TIMEOUT_MS: '20000' }, /AI_TIMEOUT_MS/],
    ['limite par minute nulle', { AI_RATE_LIMIT_PER_MINUTE: '0' }, /AI_RATE_LIMIT_PER_MINUTE/],
    ['plafond négatif', { AI_DAILY_REQUEST_CAP: '-1' }, /AI_DAILY_REQUEST_CAP/],
  ])('refuse de démarrer : %s', (_label, change, error) => {
    expect(() => loadConfig({ ...base, ...change })).toThrow(error);
  });

  it("n'affiche jamais la clé refusée", () => {
    const badKey = 'secret avec espaces '.repeat(3);
    expect(() => loadConfig({ ...base, MISTRAL_API_KEY: badKey })).not.toThrow(new RegExp(badKey));
  });
});

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

    it('exige la clé et les deux secrets de webhook en production', () => {
      expect(() => loadConfig(prodBase)).toThrow(
        /STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET.*STRIPE_CONNECT_WEBHOOK_SECRET/,
      );
      const { STRIPE_CONNECT_WEBHOOK_SECRET: _omit, ...withoutConnect } = prod;
      expect(() => loadConfig(withoutConnect)).toThrow(/STRIPE_CONNECT_WEBHOOK_SECRET/);
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
      const sid = twilio.TWILIO_ACCOUNT_SID;
      expect(() => loadConfig({ ...base, TWILIO_ACCOUNT_SID: sid })).toThrow(/TWILIO/);
      expect(() => loadConfig({ ...base, TWILIO_ACCOUNT_SID: sid })).not.toThrow(new RegExp(sid));
      expect(loadConfig({ ...base, ...twilio }).TWILIO_FROM).toBe('+33600000000');
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

  describe('production et démo', () => {
    it('accepte la vraie production (clé live, Twilio) et la démo (clé test, sans Twilio)', () => {
      expect(loadConfig(prod).DEMO_MODE).toBe(false);
      const config = loadConfig(demo);
      expect(config.DEMO_MODE).toBe(true);
      expect(config.TWILIO_ACCOUNT_SID).toBeUndefined();
    });

    it.each([
      [
        'TRUST_PROXY=false (IP du proxy pour tout le monde)',
        { TRUST_PROXY: 'false' },
        /TRUST_PROXY/,
      ],
      ['sans secret d’IP partagé avec le front', { CLIENT_IP_SECRET: '' }, /CLIENT_IP_SECRET/],
      ['secret d’IP trop court', { CLIENT_IP_SECRET: 'court' }, /CLIENT_IP_SECRET/],
      ['géocodeur en http', { GEOCODER_URL: 'http://geo.test/geocodage' }, /GEOCODER_URL/],
      ['clé de test hors démo', { STRIPE_SECRET_KEY: stripeKey('test') }, /STRIPE_SECRET_KEY/],
    ])('refuse la production : %s', (_label, change, error) => {
      expect(() => loadConfig({ ...prod, ...change })).toThrow(error);
    });

    it('exige Twilio hors démo', () => {
      expect(() => loadConfig(prodNoTwilio)).toThrow(/TWILIO_ACCOUNT_SID/);
    });

    it('refuse une clé live en mode démo, sans afficher sa valeur', () => {
      const live = stripeKey('live');
      expect(() => loadConfig({ ...demo, STRIPE_SECRET_KEY: live })).toThrow(/STRIPE_SECRET_KEY/);
      expect(() => loadConfig({ ...demo, STRIPE_SECRET_KEY: live })).not.toThrow(new RegExp(live));
    });

    it('n’affiche jamais le secret d’IP refusé', () => {
      const bad = 'secret avec espaces '.repeat(3);
      expect(() => loadConfig({ ...prod, CLIENT_IP_SECRET: bad })).not.toThrow(new RegExp(bad));
    });

    it('Sentry : facultatif, DSN en https, release « dev » par défaut', () => {
      const config = loadConfig({ ...base, SENTRY_DSN: '' });
      expect(config.SENTRY_DSN).toBeUndefined();
      expect(config.SENTRY_RELEASE).toBe('dev');
      expect(() => loadConfig({ ...base, SENTRY_DSN: 'http://k@sentry.test/1' })).toThrow(
        /SENTRY_DSN/,
      );
      expect(loadConfig({ ...base, SENTRY_RELEASE: 'abc123' }).SENTRY_RELEASE).toBe('abc123');
    });
  });

  it('interprète TRUST_PROXY', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'loopback' }).TRUST_PROXY).toBe('loopback');
  });
});
