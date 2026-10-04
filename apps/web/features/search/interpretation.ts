import {
  BOOKING_HORIZON_DAYS,
  type InterpretResponse,
  SEARCH_RADIUS_KM_DEFAULT,
} from '@creno/shared';
import { categoryLabels } from '@/features/providers/labels';
import { formatPrice } from '@/lib/format';
import { formatSearchDay, type SearchFilters, toSearchParams } from './params';

export interface AppliedInterpretation {
  /** Filtres à pousser dans l'URL (sans la position du visiteur, que seul le navigateur connaît). */
  filters: SearchFilters;
  /** « Près de moi » : la page lance la géolocalisation avant d'appliquer les filtres. */
  nearMe: boolean;
}

/**
 * Filtres après une phrase interprétée. Une phrase décrit une nouvelle recherche : ce qu'elle ne cite
 * pas repart de zéro (catégorie, prix, date, rayon par défaut), sauf le lieu, gardé si elle n'en cite
 * pas (« coiffeur samedi » cherche autour du lieu déjà choisi). Un rayon sans centre est ignoré.
 */
export function applyInterpretation(
  current: SearchFilters,
  response: InterpretResponse,
): AppliedInterpretation {
  const cited = response.filters;
  const nearMe = cited.nearMe === true;
  const place = cited.place
    ? { center: { lat: cited.place.lat, lng: cited.place.lng }, place: cited.place.label }
    : { center: current.center, place: current.place };
  // Avec « près de moi », le centre arrive après la géolocalisation.
  const hasCenter = place.center !== undefined || nearMe;
  return {
    filters: {
      ...place,
      radiusKm: hasCenter && cited.radiusKm ? cited.radiusKm : SEARCH_RADIUS_KM_DEFAULT,
      category: cited.category,
      priceMax: cited.priceMax,
      date: cited.date,
    },
    nearMe,
  };
}

/**
 * Vrai tant que les filtres de la page sont ceux de l'interprétation : une modification à la main
 * ou un retour arrière masque la ligne « Compris ». Comparés tels qu'ils s'écrivent dans l'URL.
 */
export function interpretationMatches(current: SearchFilters, applied: SearchFilters): boolean {
  return toSearchParams(current).toString() === toSearchParams(applied).toString();
}

/** Filtres compris dans la phrase, tels qu'ils ont été appliqués, pour la ligne « Compris ». */
export function understoodFilters(response: InterpretResponse, applied: SearchFilters): string[] {
  const cited = response.filters;
  const labels: string[] = [];
  if (cited.category) labels.push(categoryLabels[cited.category]);
  if (cited.place) labels.push(cited.place.label);
  else if (cited.nearMe) labels.push('Autour de moi');
  // Le rayon n'a été gardé que s'il y avait un centre.
  if (cited.radiusKm && applied.center && applied.radiusKm === cited.radiusKm) {
    labels.push(`${cited.radiusKm} km`);
  }
  if (cited.priceMax !== undefined) labels.push(`${formatPrice(cited.priceMax, 'EUR')} max`);
  if (cited.date) labels.push(formatSearchDay(cited.date));
  return labels;
}

const quoted = (text: string) => `« ${text} »`;

/** Ce que la recherche n'a pas pu prendre en compte, en phrases courtes. */
export function interpretationNotices(response: InterpretResponse): string[] {
  const notices = response.notices.map((notice) => {
    switch (notice.type) {
      case 'place_not_found':
        return `Lieu ${quoted(notice.place)} introuvable.`;
      case 'date_out_of_range':
        return `Le ${formatSearchDay(notice.date)} n'est pas réservable (d'aujourd'hui à ${BOOKING_HORIZON_DAYS} jours).`;
      case 'ignored_terms':
        return notice.terms.length === 1
          ? `${quoted(notice.terms[0]!)} n'est pas pris en compte.`
          : `${notice.terms.map(quoted).join(', ')} ne sont pas pris en compte.`;
    }
  });
  if (response.source === 'keywords') {
    notices.unshift('Recherche simplifiée par mots-clés (assistant indisponible).');
  }
  return notices;
}
