'use client';

import { SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { type InterpretResponse, SEARCH_RADIUS_KM_DEFAULT } from '@creno/shared';
import { remember } from '../handoff';
import { applyInterpretation } from '../interpretation';
import { searchHref } from '../params';
import { useAroundMe } from '../use-around-me';
import { AiSearchBar } from './ai-search-bar';

/**
 * Exemples de l'accueil, vérifiés sur les données de démo : un nom de jour plutôt que « demain »
 * (beaucoup de prestataires ferment le week-end), un lieu plutôt que « près de moi ».
 */
const HOME_EXAMPLES = [
  'Coiffeur à Paris lundi après-midi',
  'Salle de réunion à Lyon mardi matin',
  'Coiffeur à Lyon jeudi après 18 h',
];

/**
 * Recherche de l'accueil : la phrase est interprétée ici, puis `/search` s'ouvre sur les filtres
 * (géolocalisation comprise pour « près de moi »), avec la phrase et la ligne « Compris » par le
 * relais en mémoire.
 */
export function HomeAiSearch() {
  const router = useRouter();
  const { aroundMe, locating } = useAroundMe();
  const [navigating, startNavigation] = useTransition();

  async function onInterpreted(response: InterpretResponse, query: string) {
    const { filters, nearMe } = applyInterpretation(
      { radiusKm: SEARCH_RADIUS_KM_DEFAULT },
      response,
    );
    // « Près de moi » refusé ou impossible : `/search` s'ouvre sans lieu.
    const applied = (nearMe && (await aroundMe(filters))) || filters;
    remember({ query, response, applied });
    startNavigation(() => router.push(searchHref(applied)));
  }

  return (
    <div className="flex flex-col gap-3">
      <AiSearchBar
        examples={HOME_EXAMPLES}
        busy={locating || navigating}
        wakingScreen
        framed
        onInterpreted={onInterpreted}
      />
      <Link
        href="/search"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-11 w-fit items-center gap-2 text-sm underline underline-offset-4"
      >
        <SlidersHorizontal aria-hidden className="size-4" />
        Recherche détaillée (lieu, catégorie, prix, jour, horaire)
      </Link>
    </div>
  );
}
