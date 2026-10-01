'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { createResourceSchema, PRICE_CENTS_MAX, type Resource } from '@creno/shared';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api/errors';
import { useCreateResource, useUpdateResource } from '../api';

// Mêmes règles que l'API ; seul le prix est saisi en euros puis converti en centimes.
const resourceFormSchema = createResourceSchema.omit({ priceCents: true }).extend({
  priceEuros: z
    .number({ error: 'Prix requis' })
    .min(0, { error: 'Prix positif ou nul' })
    .max(PRICE_CENTS_MAX / 100, { error: 'Prix trop élevé' })
    .refine((value) => Number.isInteger(Math.round(value * 1000) / 10), {
      error: 'Deux décimales au plus',
    }),
  isActive: z.boolean(),
});
type ResourceFormValues = z.infer<typeof resourceFormSchema>;

const DEFAULT_TIMEZONE = 'Europe/Paris';

function timezones(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set([DEFAULT_TIMEZONE, current, ...supported])].sort();
}

/** Création d'une ressource, ou modification quand `resource` est fourni. */
export function ResourceForm({ resource }: { resource?: Resource }) {
  const router = useRouter();
  const create = useCreateResource();
  const update = useUpdateResource(resource?.id ?? '');
  const pending = create.isPending || update.isPending;

  const form = useForm<ResourceFormValues>({
    resolver: zodResolver(resourceFormSchema),
    defaultValues: {
      name: resource?.name ?? '',
      description: resource?.description ?? '',
      timezone: resource?.timezone ?? DEFAULT_TIMEZONE,
      slotMinutes: resource?.slotMinutes ?? 60,
      priceEuros: resource ? resource.priceCents / 100 : undefined,
      isActive: resource?.isActive ?? true,
    },
  });
  const { errors, isDirty } = form.formState;
  const timezoneItems = useMemo(
    () =>
      timezones(resource?.timezone ?? DEFAULT_TIMEZONE).map((value) => ({ value, label: value })),
    [resource?.timezone],
  );

  function onSubmit({ priceEuros, isActive, ...values }: ResourceFormValues) {
    const input = { ...values, priceCents: Math.round(priceEuros * 100) };
    const onError = (error: unknown) => toast.error(errorMessage(error));
    if (resource) {
      update.mutate(
        { ...input, isActive },
        {
          onSuccess: (updated) => {
            form.reset({ ...values, priceEuros: updated.priceCents / 100, isActive });
            toast.success('Ressource mise à jour.');
          },
          onError,
        },
      );
    } else {
      create.mutate(input, {
        onSuccess: (created) => {
          toast.success('Ressource créée. Définissez maintenant ses horaires.');
          router.push(`/dashboard/resources/${created.id}`);
        },
        onError,
      });
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="resource-name">Nom</FieldLabel>
          <Input
            id="resource-name"
            placeholder="Studio A, Coupe homme, Terrain 1…"
            aria-invalid={!!errors.name}
            {...form.register('name')}
          />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="resource-description">Description</FieldLabel>
          <Textarea
            id="resource-description"
            rows={3}
            aria-invalid={!!errors.description}
            {...form.register('description')}
          />
          <FieldError errors={[errors.description]} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!errors.slotMinutes}>
            <FieldLabel htmlFor="resource-slot">Durée d&apos;un créneau (minutes)</FieldLabel>
            <Input
              id="resource-slot"
              type="number"
              inputMode="numeric"
              min={5}
              max={1440}
              step={5}
              aria-invalid={!!errors.slotMinutes}
              {...form.register('slotMinutes', { valueAsNumber: true })}
            />
            <FieldError errors={[errors.slotMinutes]} />
          </Field>
          <Field data-invalid={!!errors.priceEuros}>
            <FieldLabel htmlFor="resource-price">Prix par créneau (€)</FieldLabel>
            <Input
              id="resource-price"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              aria-invalid={!!errors.priceEuros}
              {...form.register('priceEuros', { valueAsNumber: true })}
            />
            <FieldError errors={[errors.priceEuros]} />
          </Field>
        </div>
        <Field data-invalid={!!errors.timezone}>
          <FieldLabel htmlFor="resource-timezone">Fuseau horaire</FieldLabel>
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <Select items={timezoneItems} value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="resource-timezone"
                  className="h-11 w-full md:h-9"
                  aria-invalid={!!errors.timezone}
                  aria-describedby="resource-timezone-help"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {timezoneItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription id="resource-timezone-help">
            Les horaires de la ressource sont exprimés dans ce fuseau, été comme hiver.
          </FieldDescription>
          <FieldError errors={[errors.timezone]} />
        </Field>
        {resource && (
          <Field orientation="horizontal">
            <Controller
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <Switch
                  id="resource-active"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-describedby="resource-active-help"
                />
              )}
            />
            <div className="flex flex-col gap-0.5">
              <FieldLabel htmlFor="resource-active">Ressource active</FieldLabel>
              <FieldDescription id="resource-active-help">
                Une ressource inactive n&apos;apparaît plus sur votre fiche et ne peut plus être
                réservée.
              </FieldDescription>
            </div>
          </Field>
        )}
        <Button
          type="submit"
          className="h-11 sm:w-fit"
          disabled={pending || (!!resource && !isDirty)}
        >
          {pending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          {resource ? 'Enregistrer' : 'Créer la ressource'}
        </Button>
      </FieldGroup>
    </form>
  );
}
