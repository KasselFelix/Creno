'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  type CreateProviderInput,
  createProviderSchema,
  type Provider,
  providerCategories,
} from '@creno/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api/errors';
import { useSaveProvider } from '../api';
import { categoryLabels } from '../labels';

const categoryItems = providerCategories.map((value) => ({ value, label: categoryLabels[value] }));

/** Création du profil prestataire, ou modification quand `provider` est fourni. */
export function ProviderForm({ provider, onSaved }: { provider?: Provider; onSaved?: () => void }) {
  const save = useSaveProvider(!!provider);
  const form = useForm<CreateProviderInput>({
    resolver: zodResolver(createProviderSchema),
    defaultValues: provider ?? {
      name: '',
      category: 'other',
      description: '',
      address: '',
      city: '',
    },
  });
  const { errors } = form.formState;

  function onSubmit(values: CreateProviderInput) {
    save.mutate(values, {
      onSuccess: () => {
        toast.success(provider ? 'Profil mis à jour.' : 'Profil créé.');
        onSaved?.();
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="provider-name">Nom de l&apos;établissement</FieldLabel>
          <Input id="provider-name" aria-invalid={!!errors.name} {...form.register('name')} />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={!!errors.category}>
          <FieldLabel htmlFor="provider-category">Catégorie</FieldLabel>
          <Controller
            control={form.control}
            name="category"
            render={({ field }) => (
              <Select items={categoryItems} value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="provider-category"
                  className="h-11! w-full md:h-9!"
                  aria-invalid={!!errors.category}
                >
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
            )}
          />
          <FieldError errors={[errors.category]} />
        </Field>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="provider-description">Description</FieldLabel>
          <Textarea
            id="provider-description"
            rows={3}
            aria-invalid={!!errors.description}
            {...form.register('description')}
          />
          <FieldError errors={[errors.description]} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!errors.address}>
            <FieldLabel htmlFor="provider-address">Adresse</FieldLabel>
            <Input
              id="provider-address"
              autoComplete="street-address"
              aria-invalid={!!errors.address}
              {...form.register('address')}
            />
            <FieldError errors={[errors.address]} />
          </Field>
          <Field data-invalid={!!errors.city}>
            <FieldLabel htmlFor="provider-city">Ville</FieldLabel>
            <Input
              id="provider-city"
              autoComplete="address-level2"
              aria-invalid={!!errors.city}
              {...form.register('city')}
            />
            <FieldError errors={[errors.city]} />
          </Field>
          <Field data-invalid={!!errors.latitude}>
            <FieldLabel htmlFor="provider-latitude">Latitude</FieldLabel>
            <Input
              id="provider-latitude"
              type="number"
              step="any"
              inputMode="decimal"
              placeholder="48.8644"
              aria-invalid={!!errors.latitude}
              {...form.register('latitude', { valueAsNumber: true })}
            />
            <FieldError errors={[errors.latitude]} />
          </Field>
          <Field data-invalid={!!errors.longitude}>
            <FieldLabel htmlFor="provider-longitude">Longitude</FieldLabel>
            <Input
              id="provider-longitude"
              type="number"
              step="any"
              inputMode="decimal"
              placeholder="2.3696"
              aria-invalid={!!errors.longitude}
              {...form.register('longitude', { valueAsNumber: true })}
            />
            <FieldError errors={[errors.longitude]} />
          </Field>
        </div>
        <FieldDescription>
          Les coordonnées placent votre établissement sur la carte. Elles seront bientôt déduites de
          l&apos;adresse.
        </FieldDescription>
        <Button type="submit" className="h-11 sm:w-fit" disabled={save.isPending}>
          {save.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          {provider ? 'Enregistrer' : 'Créer mon profil'}
        </Button>
      </FieldGroup>
    </form>
  );
}
