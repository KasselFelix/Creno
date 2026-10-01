'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { providerCategories, type ProviderCategory, SEARCH_RADIUS_KM_DEFAULT } from '@creno/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlaceCombobox } from '@/features/geocoding/components/place-combobox';
import { categoryLabels } from '@/features/providers/labels';
import { searchHref, type SearchFilters } from '../params';

const ALL = 'all';
const categoryItems = [
  { value: ALL, label: 'Toutes les catégories' },
  ...providerCategories.map((value) => ({ value, label: categoryLabels[value] })),
];

/** Entrée de la recherche sur la page d'accueil : lieu + catégorie, puis redirection vers `/search`. */
export function HomeSearch() {
  const router = useRouter();
  const [place, setPlace] = useState<Pick<SearchFilters, 'center' | 'place'>>({});
  const [category, setCategory] = useState<ProviderCategory | undefined>();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    router.push(searchHref({ ...place, category, radiusKm: SEARCH_RADIUS_KM_DEFAULT }));
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 rounded-lg border p-4 shadow-sm sm:grid-cols-[2fr_1fr_auto] sm:items-end"
    >
      <Field>
        <FieldLabel htmlFor="home-place">Où ?</FieldLabel>
        <PlaceCombobox
          id="home-place"
          placeholder="Ville ou adresse"
          className="h-11 md:h-9"
          onSelect={(result) =>
            setPlace({
              center: { lat: result.latitude, lng: result.longitude },
              place: result.kind === 'city' ? result.city : result.label,
            })
          }
        />
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
      <Button type="submit" className="h-11 md:h-9">
        <Search aria-hidden />
        Rechercher
      </Button>
    </form>
  );
}
