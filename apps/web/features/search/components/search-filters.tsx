'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import {
  isSearchDateInRange,
  PRICE_CENTS_MAX,
  providerCategories,
  type ProviderCategory,
  SEARCH_RADIUS_OPTIONS_KM,
  searchDateRange,
} from '@creno/shared';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { categoryLabels } from '@/features/providers/labels';
import { type SearchFilters, searchToday } from '../params';

const ALL = 'all';
const categoryItems = [
  { value: ALL, label: 'Toutes' },
  ...providerCategories.map((value) => ({ value, label: categoryLabels[value] })),
];

/** « 30 » ou « 29,90 » (euros) → centimes ; vide ou invalide → pas de filtre. */
function eurosToCents(text: string): number | undefined {
  const euros = Number(text.trim().replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(euros) || euros < 0) return undefined;
  return Math.min(Math.round(euros * 100), PRICE_CENTS_MAX);
}

function PriceMaxInput({
  id,
  priceMax,
  onCommit,
}: {
  id: string;
  priceMax: number | undefined;
  onCommit: (priceMax: number | undefined) => void;
}) {
  const [text, setText] = useState(priceMax === undefined ? '' : String(priceMax / 100));
  // La recherche part à la validation du champ (Entrée ou sortie du champ), pas à chaque chiffre.
  const commit = () => {
    const next = eurosToCents(text);
    if (next !== priceMax) onCommit(next);
  };
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={0}
      step={1}
      placeholder="Sans limite"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}

/** Jour où le prestataire doit avoir un créneau libre : d'aujourd'hui à l'horizon (heure de Paris). */
function DateInput({
  id,
  date,
  onCommit,
}: {
  id: string;
  date: string | undefined;
  onCommit: (date: string | undefined) => void;
}) {
  const today = searchToday();
  const { min, max } = searchDateRange(today);
  const [text, setText] = useState(date ?? '');
  // Filtre changé ailleurs (bouton retour, phrase interprétée) : le champ suit, sans être remonté
  // (il garderait sinon le focus d'un visiteur qui tape la date au clavier).
  const [shown, setShown] = useState(date);
  if (date !== shown) {
    setShown(date);
    setText(date ?? '');
  }

  return (
    <InputGroup className="h-11 md:h-9">
      <InputGroupInput
        id={id}
        type="date"
        min={min}
        max={max}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          // Vide : peut-être une saisie en cours, le filtre n'est retiré qu'à la sortie du champ.
          if (next !== '' && next !== date && isSearchDateInRange(next, today)) onCommit(next);
        }}
        onBlur={() => {
          if (text === '' && date !== undefined) onCommit(undefined);
        }}
      />
      {date && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            aria-label="Effacer la date"
            onClick={() => {
              setText('');
              onCommit(undefined);
            }}
          >
            <X aria-hidden />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/** Champs de filtre, affichés en barre sur desktop et dans un panneau sur mobile. */
export function SearchFilterFields({
  idPrefix,
  filters,
  onChange,
}: {
  /** Les champs existent deux fois dans la page (barre et panneau) : leurs `id` doivent différer. */
  idPrefix: string;
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}) {
  // Un rayon venu de l'URL peut ne pas faire partie des choix proposés.
  const radiusOptions = [...new Set([...SEARCH_RADIUS_OPTIONS_KM, filters.radiusKm])].sort(
    (a, b) => a - b,
  );
  const radiusItems = radiusOptions.map((km) => ({ value: String(km), label: `${km} km` }));

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-category`}>Catégorie</FieldLabel>
        <Select
          items={categoryItems}
          value={filters.category ?? ALL}
          onValueChange={(value) =>
            onChange({
              ...filters,
              category: value === ALL ? undefined : (value as ProviderCategory),
            })
          }
        >
          <SelectTrigger id={`${idPrefix}-category`} className="h-11! w-full md:h-9!">
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
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-radius`}>Rayon</FieldLabel>
        <Select
          items={radiusItems}
          value={String(filters.radiusKm)}
          disabled={!filters.center}
          onValueChange={(value) => onChange({ ...filters, radiusKm: Number(value) })}
        >
          <SelectTrigger
            id={`${idPrefix}-radius`}
            className="h-11! w-full md:h-9!"
            aria-describedby={filters.center ? undefined : `${idPrefix}-radius-help`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {radiusItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!filters.center && (
          <FieldDescription id={`${idPrefix}-radius-help`} className="lg:sr-only">
            Choisissez d&apos;abord un lieu.
          </FieldDescription>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-price`}>Prix maximum (€)</FieldLabel>
        <PriceMaxInput
          // Remonté quand le filtre change ailleurs (bouton retour, réinitialisation).
          key={filters.priceMax ?? 'none'}
          id={`${idPrefix}-price`}
          priceMax={filters.priceMax}
          onCommit={(priceMax) => onChange({ ...filters, priceMax })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-date`}>Disponible le</FieldLabel>
        <DateInput
          id={`${idPrefix}-date`}
          date={filters.date}
          onCommit={(date) => onChange({ ...filters, date })}
        />
      </Field>
    </>
  );
}
