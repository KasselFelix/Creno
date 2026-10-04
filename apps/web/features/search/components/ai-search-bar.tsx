'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, LoaderCircle, Search, Sparkles } from 'lucide-react';
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

/** Exemples cliquables, choisis pour donner des résultats avec les données de démo. */
const EXAMPLES = [
  'Coiffeur à Lyon samedi, moins de 30 €',
  'Terrain de foot près de moi ce week-end',
  'Salle de réunion à Paris pour 10 personnes',
];

/**
 * Recherche en langage naturel : la phrase part à l'API, qui renvoie des filtres validés. La phrase
 * reste dans le champ (jamais dans l'URL) ; la page applique les filtres.
 */
export function AiSearchBar({
  onInterpreted,
}: {
  onInterpreted: (response: InterpretResponse) => void | Promise<void>;
}) {
  const interpret = useInterpretSearch();
  const form = useForm<InterpretRequest>({
    resolver: zodResolver(interpretRequestSchema),
    defaultValues: { query: '' },
  });
  const { errors } = form.formState;
  const query = useWatch({ control: form.control, name: 'query' });
  const rateLimited =
    interpret.error instanceof ApiClientError && interpret.error.code === 'TOO_MANY_REQUESTS';

  const submit = form.handleSubmit((values) =>
    interpret.mutate(values, { onSuccess: (response) => void onInterpreted(response) }),
  );

  function runExample(example: string) {
    form.setValue('query', example);
    void submit();
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={(event) => void submit(event)} noValidate role="search">
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
                aria-busy={interpret.isPending}
                aria-describedby="ai-query-help"
                {...form.register('query')}
              />
            </InputGroup>
            <Button type="submit" className="h-11 md:h-9" disabled={interpret.isPending}>
              {interpret.isPending ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : (
                <Search aria-hidden />
              )}
              Rechercher
            </Button>
          </div>
          <FieldDescription id="ai-query-help">
            Votre phrase est analysée par Mistral AI (hébergé dans l&apos;UE) : n&apos;y mettez pas
            d&apos;informations personnelles.
          </FieldDescription>
          <FieldError errors={[errors.query]} />
        </Field>
      </form>

      {query === '' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">Par exemple :</span>
          {EXAMPLES.map((example) => (
            <Button
              key={example}
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              disabled={interpret.isPending}
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
