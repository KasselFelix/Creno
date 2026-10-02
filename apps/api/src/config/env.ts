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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
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
