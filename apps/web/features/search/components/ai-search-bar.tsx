'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, LoaderCircle, Search, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  AI_QUERY_MAX,
  type InterpretRequest,
  interpretRequestSchema,
  type InterpretResponse,
} from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ApiClientError } from '@/lib/api/errors';
import { useInterpretSearch } from '../api';
import { interpretationNotices, understoodFilters } from '../interpretation';
import type { SearchFilters } from '../params';

/** Exemples de `/search`, choisis pour donner des résultats avec les données de démo. */
export const SEARCH_EXAMPLES = [
  'Coiffeur à Lyon samedi, moins de 30 €',
  'Terrain de foot près de moi ce week-end',
  'Salle de réunion à Paris mardi matin',
];

/** Au-delà, le message d'attente s'affiche : l'API sort peut-être de veille (20 à 30 s). */
const SLOW_AFTER_MS = 3000;

/**
 * Réveille l'API en veille pendant que le visiteur tape : une requête sans attendre la réponse
 * (liveness, qui ne touche pas la base). Un échec ne change rien, la recherche réveillera l'API.
 */
function wakeUpApi() {
  void fetch('/api/health', { cache: 'no-store' }).catch(() => undefined);
}

/**
 * Recherche en langage naturel : la phrase part à l'API, qui renvoie des filtres validés. La phrase
 * reste dans le champ (jamais dans l'URL) ; la page applique les filtres.
 */
export function AiSearchBar({
  examples,
  defaultQuery = '',
  busy = false,
  wakeApi = false,
  onInterpreted,
}: {
  examples: readonly string[];
  /** Phrase déjà interprétée (relais de l'accueil). */
  defaultQuery?: string;
  /** La page travaille encore après l'interprétation (géolocalisation, navigation). */
  busy?: boolean;
  /** Réveille l'API au premier contact avec la barre (accueil) ; `/search` l'a déjà réveillée. */
  wakeApi?: boolean;
  onInterpreted: (response: InterpretResponse, query: string) => void | Promise<void>;
}) {
  const interpret = useInterpretSearch();
  const form = useForm<InterpretRequest>({
    resolver: zodResolver(interpretRequestSchema),
    defaultValues: { query: defaultQuery },
  });
  const pending = interpret.isPending || busy;

  const woken = useRef(false);
  function onFirstContact() {
    if (!wakeApi || woken.current) return;
    woken.current = true;
    wakeUpApi();
  }

  // Message d'attente pour la recherche en cours seulement (`submittedAt` l'identifie).
  const [slowSince, setSlowSince] = useState<number | null>(null);
  const { isPending, submittedAt } = interpret;
  useEffect(() => {
    if (!isPending) return;
    const timer = setTimeout(() => setSlowSince(submittedAt), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isPending, submittedAt]);
  const slow = isPending && slowSince === submittedAt;
  const { errors } = form.formState;
  const query = useWatch({ control: form.control, name: 'query' });
  const rateLimited =
    interpret.error instanceof ApiClientError && interpret.error.code === 'TOO_MANY_REQUESTS';

  const submit = form.handleSubmit((values) =>
    interpret.mutate(values, {
      onSuccess: (response) => void onInterpreted(response, values.query),
    }),
  );

  function runExample(example: string) {
    form.setValue('query', example);
    void submit();
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        {/* Clic ou focus : Safari ne donne pas le focus à un bouton cliqué (exemples). */}
        <form
          onSubmit={(event) => void submit(event)}
          onFocusCapture={onFirstContact}
          onPointerDownCapture={onFirstContact}
          noValidate
          role="search"
        >
          <Field data-invalid={!!errors.query}>
            <FieldLabel htmlFor="ai-query">Décrivez ce que vous cherchez</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <InputGroup className="h-11 sm:flex-1 md:h-9">
                <InputGroupAddon>
                  <Sparkles aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  id="ai-query"
                  placeholder="Terrain de foot à Bordeaux samedi"
                  maxLength={AI_QUERY_MAX}
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-invalid={!!errors.query}
                  aria-busy={pending}
                  aria-describedby="ai-query-help"
                  {...form.register('query')}
                />
              </InputGroup>
              <Button type="submit" className="h-11 md:h-9" disabled={pending}>
                {pending ? (
                  <LoaderCircle aria-hidden className="animate-spin" />
                ) : (
                  <Search aria-hidden />
                )}
                Rechercher
              </Button>
            </div>
            <FieldDescription id="ai-query-help">
              Votre phrase est analysée par Mistral AI (hébergé dans l&apos;UE) : n&apos;y mettez
              pas d&apos;informations personnelles.
            </FieldDescription>
            <FieldError errors={[errors.query]} />
          </Field>
        </form>

        {/* Région toujours présente (vide sans attente) : les lecteurs d'écran annoncent le message. */}
        <div aria-live="polite">
          {slow && (
            <p className="text-muted-foreground mt-2 text-sm">
              Recherche en cours… Si le serveur était en veille, cela peut prendre jusqu&apos;à 30
              secondes.
            </p>
          )}
        </div>
      </div>

      {query === '' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">Par exemple :</span>
          {examples.map((example) => (
            <Button
              key={example}
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              disabled={pending}
              onClick={() => runExample(example)}
            >
              {example}
            </Button>
          ))}
        </div>
      )}

      {rateLimited ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>Trop de recherches, réessayez dans une minute.</AlertDescription>
        </Alert>
      ) : (
        interpret.isError && (
          <QueryError
            title="Recherche impossible"
            error={interpret.error}
            onRetry={() => void submit()}
          />
        )
      )}
    </div>
  );
}

/**
 * Ligne « Compris » : filtres tirés de la phrase et ce qui n'a pas été pris en compte. La région
 * reste dans la page (vide quand la ligne est masquée) pour que les lecteurs d'écran l'annoncent.
 */
export function InterpretationSummary({
  interpretation,
}: {
  interpretation: { response: InterpretResponse; applied: SearchFilters } | null;
}) {
  const labels = interpretation
    ? understoodFilters(interpretation.response, interpretation.applied)
    : [];
  const notices = interpretation ? interpretationNotices(interpretation.response) : [];

  return (
    <div aria-live="polite">
      {interpretation && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Compris :</span>
            {labels.length === 0 ? (
              <span>aucun filtre</span>
            ) : (
              labels.map((label) => (
                <Badge key={label} variant="secondary">
                  {label}
                </Badge>
              ))
            )}
          </div>
          {notices.map((notice) => (
            <p key={notice} className="text-muted-foreground text-sm">
              {notice}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
