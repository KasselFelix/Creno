import { z } from 'zod';

/** Valeur d'exemple de `.env.example` : acceptée en développement, refusée en production. */
export const EXAMPLE_JWT_SECRET = 'dev-only-change-me-dev-only-change-me-0000';

/** `TRUST_PROXY` : false, true, un nombre de proxys, ou une liste d'adresses (syntaxe Express). */
const trustProxySchema = z
  .string()
  .default('false')
  .transform((value): boolean | number | string => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return /^\d+$/.test(value) ? Number(value) : value;
  });

/** Une variable laissée vide (`STRIPE_SECRET_KEY=` dans `.env`, ou transmise vide par docker compose) vaut absente. */
const optionalSecret = (pattern: RegExp, format: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(pattern, { error: format }).optional(),
  );

/** Variables d'environnement de l'API, validées au démarrage : l'API refuse de démarrer si l'une manque. */
export const envSchema = z
  .object({
    // Pas de valeur par défaut : un déploiement qui oublie NODE_ENV ne doit pas passer en mode dev (Swagger).
    NODE_ENV: z.enum(['development', 'test', 'production']),
    API_PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    WEB_ORIGIN: z.url().transform((url) => new URL(url).origin),
    TRUST_PROXY: trustProxySchema,
    JWT_ACCESS_SECRET: z.string().min(32, { error: '32 caractères minimum' }),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    BOOKING_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
    // Géocodeur d'adresses (Géoplateforme de l'IGN) : pas de clé, donc rien de secret ici.
    GEOCODER_URL: z.url({ protocol: /^https?$/ }).default('https://data.geopf.fr/geocodage'),
    // Stripe. Sans clé (clone frais), l'API démarre et les routes de paiement répondent 503.
    STRIPE_SECRET_KEY: optionalSecret(/^(sk|rk)_(test|live)_\w+$/, 'clé secrète Stripe attendue'),
    STRIPE_WEBHOOK_SECRET: optionalSecret(/^whsec_\w+$/, 'secret de webhook Stripe attendu'),
    // En production, `account.updated` arrive sur un endpoint « Connect », qui a son propre secret.
    STRIPE_CONNECT_WEBHOOK_SECRET: optionalSecret(
      /^whsec_\w+$/,
      'secret de webhook Stripe attendu',
    ),
    // Commission Creno en points de base : 1000 = 10 %.
    STRIPE_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(1000),
    // Workers et tâches planifiées (pg-boss). `false` : l'instance crée des jobs sans en exécuter.
    JOBS_WORKERS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    // Email. Resend en production ; sans clé, Mailpit (boîte de réception de dev) si son adresse est
    // donnée ; sinon aucun email ne part et les notifications sont marquées `skipped`.
    RESEND_API_KEY: optionalSecret(/^re_\w+$/, 'clé API Resend attendue'),
    EMAIL_FROM: z
      .string()
      .regex(/^([^<>\r\n]+ <[^<>@\s]+@[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+)$/, {
        error: 'format attendu : Nom <adresse@domaine>',
      })
      .default('Creno <onboarding@resend.dev>'),
    MAILPIT_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url({ protocol: /^https?$/ }).optional(),
    ),
    // SMS (Twilio) : les trois variables ensemble, ou aucune.
    TWILIO_ACCOUNT_SID: optionalSecret(
      /^AC[0-9a-fA-F]{32}$/,
      'identifiant de compte Twilio attendu',
    ),
    TWILIO_AUTH_TOKEN: optionalSecret(
      /^[0-9a-fA-F]{32}$/,
      "jeton d'authentification Twilio attendu",
    ),
    // Préfixes des numéros qui peuvent recevoir un SMS (défaut : mobiles français). Un numéro
    // hors liste ne reçoit rien : frein à la fraude vers des numéros surtaxés à l'étranger.
    SMS_ALLOWED_PREFIXES: z
      .string()
      .regex(/^\+\d{1,6}(,\+\d{1,6})*$/, { error: 'liste de préfixes attendue, ex. +336,+337' })
      .default('+336,+337')
      .transform((value) => value.split(',')),
    // Numéro expéditeur au format international, ou identifiant d'un Messaging Service.
    TWILIO_FROM: optionalSecret(
      /^(\+[1-9]\d{6,14}|MG[0-9a-fA-F]{32})$/,
      'numéro E.164 ou Messaging Service attendu',
    ),
  })
  .superRefine((env, ctx) => {
    // Une clé « live » encaisse de vrais paiements : jamais en développement ni en test.
    if (env.NODE_ENV !== 'production' && /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? '')) {
      ctx.addIssue({
        code: 'custom',
        path: ['STRIPE_SECRET_KEY'],
        message: 'clé de test (sk_test_…) obligatoire hors production',
      });
    }
    const twilio = [env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM];
    if (twilio.some(Boolean) && !twilio.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TWILIO_ACCOUNT_SID'],
        message: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_FROM vont ensemble',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    // Mailpit n'envoie rien : en production, il masquerait l'absence d'emails réels.
    if (env.MAILPIT_URL) {
      ctx.addIssue({ code: 'custom', path: ['MAILPIT_URL'], message: 'interdite en production' });
    }
    // L'expéditeur de démonstration de Resend n'écrit qu'à l'adresse du compte : tout échouerait.
    if (/@resend\.dev>?$/.test(env.EMAIL_FROM)) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'expéditeur sur un domaine vérifié obligatoire en production',
      });
    }
    for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY'] as const) {
      if (!env[name]) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'obligatoire en production' });
      }
    }
    if (/change-me|dev-only/i.test(env.JWT_ACCESS_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: "valeur d'exemple interdite en production",
      });
    }
    // `true` ferait confiance à n'importe quel X-Forwarded-For : un client pourrait choisir son IP
    // et contourner le rate limit. En production, on déclare le nombre exact de proxys.
    if (env.TRUST_PROXY === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'indiquer le nombre de proxys (ou leurs adresses), pas "true"',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // On n'affiche que le nom de la variable et la règle, jamais la valeur (secrets).
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuration invalide : ${problems}`);
  }
  return result.data;
}
