'use client';

import { useState } from 'react';
import { GEOCODING_QUERY_MIN, type GeocodingResult } from '@creno/shared';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { usePlaceSuggestions } from '../api';

const DEBOUNCE_MS = 300;

interface PlaceComboboxProps {
  id: string;
  placeholder?: string;
  /** Texte affiché au départ (lieu déjà choisi). */
  defaultText?: string;
  onSelect: (place: GeocodingResult) => void;
  /** Texte du champ à chaque frappe : permet à l'appelant de savoir qu'il ne correspond plus au lieu choisi. */
  onTextChange?: (text: string) => void;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
  className?: string;
}

/** Champ « ville ou adresse » avec suggestions du géocodeur. Le libellé (`<label>`) est fourni par l'appelant. */
export function PlaceCombobox({
  id,
  placeholder,
  defaultText = '',
  onSelect,
  onTextChange,
  className,
  ...aria
}: PlaceComboboxProps) {
  const [text, setText] = useState(defaultText);
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedValue(text, DEBOUNCE_MS);
  const suggestions = usePlaceSuggestions(debounced);
  const tooShort = text.trim().length < GEOCODING_QUERY_MIN;
  const items = tooShort ? [] : (suggestions.data?.items ?? []);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Combobox<GeocodingResult>
        items={items}
        // Le géocodeur a déjà filtré et classé : pas de second filtre côté navigateur.
        filter={null}
        open={open}
        onOpenChange={setOpen}
        inputValue={text}
        onInputValueChange={(value) => {
          setText(value);
          onTextChange?.(value);
        }}
        onValueChange={(place) => {
          if (place) onSelect(place);
        }}
        itemToStringLabel={(place) => place.label}
        itemToStringValue={(place) => place.label}
        isItemEqualToValue={(a, b) => a.label === b.label}
      >
        <ComboboxInput
          id={id}
          placeholder={placeholder}
          autoComplete="off"
          showTrigger={false}
          // Entrée sans suggestion surlignée aux flèches : on prend la première, comme dans une
          // barre de recherche. (Entrée sur une suggestion surlignée est géré par le composant.)
          onKeyDown={(event) => {
            const first = items[0];
            const highlighted = event.currentTarget.getAttribute('aria-activedescendant');
            if (event.key !== 'Enter' || !open || highlighted || !first) return;
            event.preventDefault();
            setText(first.label);
            onTextChange?.(first.label);
            setOpen(false);
            onSelect(first);
          }}
          className={className}
          {...aria}
        />
        {!tooShort && (
          <ComboboxContent>
            <ComboboxEmpty>
              {suggestions.isError
                ? 'Suggestions indisponibles.'
                : suggestions.isFetching || debounced !== text
                  ? 'Recherche…'
                  : 'Aucun lieu trouvé.'}
            </ComboboxEmpty>
            <ComboboxList>
              {(place: GeocodingResult) => (
                <ComboboxItem
                  key={`${place.label}|${place.latitude}|${place.longitude}`}
                  value={place}
                  className="min-h-11 pr-2 md:min-h-8"
                >
                  {place.label}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        )}
      </Combobox>
      {suggestions.isError && !tooShort && (
        <p role="status" className="text-muted-foreground text-sm">
          La recherche d&apos;adresse est momentanément indisponible.
        </p>
      )}
    </div>
  );
}
