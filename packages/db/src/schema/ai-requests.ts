import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { providerCategory } from './providers.js';

/**
 * Issue d'une interprétation : toute valeur autre que `success` signifie un repli sur les mots-clés.
 * `circuit_open`, `budget_exceeded` et `not_configured` n'appellent pas le modèle ; les autres, si.
 */
export const aiRequestOutcome = pgEnum('ai_request_outcome', [
  'success',
  'invalid_output',
  'timeout',
  'rate_limited',
  'upstream_error',
  'circuit_open',
  'budget_exceeded',
  'not_configured',
]);

/** Filtres renvoyés par une interprétation : rien qui localise le visiteur, ni lieu ni coordonnées. */
export interface AiRequestFilters {
  category: (typeof providerCategory.enumValues)[number] | null;
  radiusKm: number | null;
  /** Prix maximum en centimes. */
  priceMax: number | null;
  date: string | null;
  hasPlace: boolean;
  nearMe: boolean;
}

// Journal de la recherche en langage naturel : une ligne par phrase interprétée, que le modèle ait
// été appelé ou non. Ni la phrase ni le lieu, seulement la longueur de la phrase et les filtres non
// localisants. Sert au plafond journalier d'appels et aux statistiques de coût et de latence.
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Identifiant de requête des logs pino : relie la ligne à ses logs.
    requestId: text('request_id').notNull(),
    outcome: aiRequestOutcome('outcome').notNull(),
    // Modèle qui a répondu, ou modèle configuré si aucune réponse n'est arrivée ; NULL sans appel.
    model: text('model'),
    // Appels au modèle, reprise comprise : c'est ce que compte le plafond journalier.
    attempts: smallint('attempts').notNull().default(0),
    // Durée des appels au modèle (tentatives et attente entre elles), 0 sans appel.
    latencyMs: integer('latency_ms').notNull(),
    // Tokens de la réponse reçue (NULL sans réponse) et coût au tarif payant, en micro-dollars.
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsdMicros: integer('cost_usd_micros'),
    queryLength: smallint('query_length').notNull(),
    filters: jsonb('filters').$type<AiRequestFilters>(),
  },
  (t) => [
    // Plafond journalier (appels depuis minuit UTC), statistiques par période et purge à 90 jours.
    index('ai_requests_created_at_idx').on(t.createdAt),
    check('ai_requests_attempts_range', sql`${t.attempts} BETWEEN 0 AND 2`),
    check('ai_requests_latency_positive', sql`${t.latencyMs} >= 0`),
    check('ai_requests_input_tokens_positive', sql`${t.inputTokens} >= 0`),
    check('ai_requests_output_tokens_positive', sql`${t.outputTokens} >= 0`),
    check('ai_requests_cost_positive', sql`${t.costUsdMicros} >= 0`),
    // Mêmes bornes que la phrase acceptée par l'API (AI_QUERY_MIN / AI_QUERY_MAX, après trim).
    check('ai_requests_query_length_range', sql`${t.queryLength} BETWEEN 3 AND 200`),
    check('ai_requests_model_needs_call', sql`${t.attempts} > 0 OR ${t.model} IS NULL`),
    // Circuit ouvert, plafond atteint ou clé absente : aucun appel. Toute autre issue en a fait un.
    check(
      'ai_requests_attempts_match_outcome',
      sql`(${t.outcome} IN ('circuit_open', 'budget_exceeded', 'not_configured')) = (${t.attempts} = 0)`,
    ),
  ],
);
