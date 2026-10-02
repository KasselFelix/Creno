'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  GEOCODING_QUERY_MIN,
  type GeocodingResult,
  providerCategories,
  type ProviderCategory,
  SEARCH_RADIUS_KM_DEFAULT,
} from '@creno/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { placeSuggestionsQuery } from '@/features/geocoding/api';
import { PlaceCombobox } from '@/features/geocoding/components/place-combobox';
import { categoryLabels } from '@/features/providers/labels';
import { errorMessage } from '@/lib/api/errors';
import { searchHref, type SearchFilters } from '../params';

const ALL = 'all';
const categoryItems = [
  { value: ALL, label: 'Toutes les catégories' },
  ...providerCategories.map((value) => ({ value, label: categoryLabels[value] })),
];

/** Entrée de la recherche sur la page d'accueil : lieu + catégorie, puis redirection vers `/search`. */
export function HomeSearch() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<GeocodingResult | null>(null);
  const [category, setCategory] = useState<ProviderCategory | undefined>();
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Lieu de la recherche : la suggestion choisie, sinon la première suggestion du texte saisi. */
  async function resolvePlace(): Promise<GeocodingResult | null> {
    const typed = text.trim();
    // Le texte a été modifié après le choix : la suggestion choisie ne le décrit plus.
    if (selected && selected.label === typed) return selected;
    const { items } = await queryClient.fetchQuery(placeSuggestionsQuery(typed));
    return items[0] ?? null;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const filters: SearchFilters = { category, radiusKm: SEARCH_RADIUS_KM_DEFAULT };
    if (text.trim() === '') {
      router.push(searchHref(filters));
      return;
    }
    if (text.trim().length < GEOCODING_QUERY_MIN) {
      setPlaceError('Choisissez un lieu dans la liste.');
      return;
    }
    setPending(true);
    try {
      const place = await resolvePlace();
      if (!place) {
        setPlaceError('Lieu introuvable. Choisissez un lieu dans la liste.');
        return;
      }
      router.push(
        searchHref({
          ...filters,
          center: { lat: place.latitude, lng: place.longitude },
          place: place.kind === 'city' ? place.city : place.label,
        }),
      );
    } catch (error) {
      setPlaceError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-3 rounded-lg border p-4 shadow-sm sm:grid-cols-[2fr_1fr_auto] sm:items-start"
    >
      <Field data-invalid={!!placeError}>
        <FieldLabel htmlFor="home-place">Où ?</FieldLabel>
        <PlaceCombobox
          id="home-place"
          placeholder="Ville ou adresse"
          className="h-11 md:h-9"
          aria-invalid={!!placeError}
          onTextChange={(value) => {
            setText(value);
            setPlaceError(null);
          }}
          onSelect={setSelected}
        />
        {placeError && <FieldError>{placeError}</FieldError>}
      </Field>
      <Field>
        <FieldLabel htmlFor="home-category">Quoi ?</FieldLabel>
        <Select
          items={categoryItems}
          value={category ?? ALL}
          onValueChange={(value) =>
            setCategory(value === ALL ? undefined : (value as ProviderCategory))
          }
        >
          <SelectTrigger id="home-category" className="h-11! w-full md:h-9!">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {/* Aligné sur les champs : décalé de la hauteur d'un libellé. */}
      <Button type="submit" className="h-11 sm:mt-7 md:h-9" disabled={pending}>
        {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Search aria-hidden />}
        Rechercher
      </Button>
    </form>
  );
}
