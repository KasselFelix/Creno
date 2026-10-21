'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, History, LoaderCircle, Search, Sparkles, X } from 'lucide-react';
import { cn } from 'cn';
import Link from 'next/link';
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
import { ButtonGroup } from '@/components/ui/button-group';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { useWakingScreen } from '@/features/health/api-wake-up';
import { ApiClientError } from '@/lib/api/errors';
import { useInterpretSearch } from '../api';
import { interpretationNotices, understoodFilters } from '../interpretation';
import {
  forgetRecentSearch,
  isWorthRemembering,
  saveRecentSearch,
  useRecentSearches,
  visibleSuggestions,
} from '../recent-searches';
import type { SearchFilters } from '../params';
import styles from './ai-search-bar.module.css';

/** Exemples de `/search`, choisis pour donner des résultats avec les données de démo. */
export const SEARCH_EXAMPLES = [
  'Coiffeur à Lyon samedi, moins de 30 €',
  'Terrain de foot près de moi ce week-end',
  'Salle de réunion à Paris mardi matin',
];

/** Au-delà, « Recherche en cours… » s'affiche (Mistral lent). Un réveil de l'API a son propre avis. */
const SLOW_AFTER_MS = 3000;

/**
 * Recherche en langage naturel : la phrase part à l'API, qui renvoie des filtres validés. La phrase
 * reste dans le champ (jamais dans l'URL) ; la page applique les filtres.
 */
export function AiSearchBar({
  examples,
  defaultQuery = '',
  busy = false,
  framed = false,
  wakingScreen = false,
  onInterpreted,
}: {
  examples: readonly string[];
  /** Phrase déjà interprétée (relais de l'accueil). */
  defaultQuery?: string;
  /** La page travaille encore après l'interprétation (géolocalisation, navigation). */
  busy?: boolean;
  /** Champ dans un cadre (accueil). */
  framed?: boolean;
  /** Pendant un réveil de l'API, l'écran de chargement couvre la page jusqu'à la suivante (accueil). */
  wakingScreen?: boolean;
  onInterpreted: (response: InterpretResponse, query: string) => void | Promise<void>;
}) {
  const interpret = useInterpretSearch();
  const form = useForm<InterpretRequest>({
    resolver: zodResolver(interpretRequestSchema),
    defaultValues: { query: defaultQuery },
  });
  const pending = interpret.isPending || busy;
  useWakingScreen(wakingScreen && pending);

  const [noticeShown, setNoticeShown] = useState(false);
  // Dernière phrase lancée (au départ, celle relayée par l'accueil) : la rangée de propositions reste
  // visible tant que le champ la contient.
  const [submitted, setSubmitted] = useState(defaultQuery);
  const recent = useRecentSearches();
  const rowRef = useRef<HTMLDivElement>(null);

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

  const submit = form.handleSubmit((values) => {
    setSubmitted(values.query);
    interpret.mutate(values, {
      onSuccess: (response) => {
        // Seule la phrase est gardée, et seulement si elle mène quelque part rejouée ailleurs.
        if (isWorthRemembering(response)) saveRecentSearch(values.query);
        void onInterpreted(response, values.query);
      },
    });
  });
  // Liste inconnue pendant le rendu serveur et l'hydratation : rangée invisible (place gardée),
  // plutôt que des exemples remplacés sous le doigt par l'historique.
  const suggestions = visibleSuggestions({ recent: recent ?? [], examples, query, submitted });

  /** La croix disparaît avec sa pastille : le focus passe à la croix voisine, sinon au champ. */
  function forget(text: string, cross: HTMLButtonElement) {
    const crosses = [
      ...(rowRef.current?.querySelectorAll<HTMLButtonElement>('[data-forget]') ?? []),
    ];
    const index = crosses.indexOf(cross);
    // Pastilles indexées par leur texte : la voisine reste le même élément après le rendu.
    const neighbour = crosses[index + 1] ?? crosses[index - 1];
    forgetRecentSearch(text);
    if (neighbour) neighbour.focus();
    else form.setFocus('query');
  }

  function runExample(example: string) {
    // La phrase part à Mistral sans passer par le champ : la mention s'affiche aussi.
    setNoticeShown(true);
    form.setValue('query', example);
    void submit();
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          role="search"
          className={framed ? 'rounded-lg border p-4 shadow-sm' : undefined}
        >
          <Field data-invalid={!!errors.query}>
            <FieldLabel htmlFor="ai-query">Que recherchez-vous ?</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              {/* Bordure lumineuse de l'IA : elle remplace l'anneau de focus du champ. */}
              <InputGroup
                className={cn(
                  'h-11 sm:flex-1 md:h-9',
                  'has-[[data-slot=input-group-control]:focus-visible]:ring-0',
                  styles.aiField,
                )}
              >
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
                  onFocus={() => setNoticeShown(true)}
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
            {/* Visible dès que le champ a été sélectionné, puis gardée (un clic sur le lien ne la
                masque pas). Avant, `invisible` garde sa place (rien ne bouge à l'apparition) ;
                `aria-describedby` la fait lire quand même avec le champ. */}
            <FieldDescription id="ai-query-help" className={noticeShown ? undefined : 'invisible'}>
              Phrase analysée par Mistral AI (UE) ·{' '}
              <Link href="/confidentialite" className="underline underline-offset-4">
                Confidentialité
              </Link>
            </FieldDescription>
            <FieldError errors={[errors.query]} />
          </Field>
        </form>

        {/* Région toujours présente (vide sans attente) : les lecteurs d'écran annoncent le message. */}
        <div aria-live="polite">
          {slow && <p className="text-muted-foreground mt-2 text-sm">Recherche en cours…</p>}
        </div>
      </div>

      {/* Masqués (pas retirés) pendant la frappe d'une nouvelle phrase : leur place reste réservée,
          rien ne bouge en dessous. `invisible` les retire aussi du clavier et des lecteurs d'écran. */}
      {/* Mobile : une seule ligne qui défile (la place réservée reste d'une ligne) ; desktop : retour
          à la ligne. `p-1 -m-1` laisse la place à l'anneau de focus, que le défilement couperait. */}
      {/* Jamais la phrase dans un attribut (`aria-label`, `title`) : Sentry les recopie dans le fil
          d'Ariane d'un clic. Elle reste dans le texte des boutons. */}
      <div
        ref={rowRef}
        role="group"
        aria-label="Suggestions de recherche"
        className={cn(
          // `relative` : les textes `sr-only` (absolus) restent dans la rangée qui défile, sinon ils
          // élargissent la page sur mobile.
          'relative -m-1 flex items-center gap-2 overflow-x-auto p-1 sm:flex-wrap sm:overflow-visible',
          (recent === null || !suggestions.visible) && 'invisible',
        )}
      >
        {suggestions.items.map(({ text, recent: isRecent }) =>
          isRecent ? (
            <ButtonGroup key={text} className="shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 md:h-8"
                disabled={pending}
                onClick={() => runExample(text)}
              >
                <History aria-hidden />
                <span className="sr-only">Recherche récente : </span>
                <span className="max-w-64 truncate">{text}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                data-forget
                className="size-11 md:size-8"
                onClick={(event) => forget(text, event.currentTarget)}
              >
                <X aria-hidden />
                <span className="sr-only">Retirer « {text} » de l’historique</span>
              </Button>
            </ButtonGroup>
          ) : (
            <Button
              key={text}
              type="button"
              variant="outline"
              size="sm"
              className="h-11 shrink-0 md:h-8"
              disabled={pending}
              onClick={() => runExample(text)}
            >
              {text}
            </Button>
          ),
        )}
      </div>

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
