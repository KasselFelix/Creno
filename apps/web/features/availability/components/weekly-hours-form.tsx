'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, Plus, X } from 'lucide-react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { type AvailabilityRule, type ReplaceRulesInput, replaceRulesSchema } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api/errors';
import { useReplaceRules, useRules } from '../api';
import { toApi, toForm } from '../hours';

const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export function WeeklyHoursForm({ resourceId }: { resourceId: string }) {
  const rules = useRules(resourceId);

  if (rules.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        {WEEKDAYS.map((day) => (
          <Skeleton key={day} className="h-11 w-full" />
        ))}
        <span className="sr-only">Chargement des horaires…</span>
      </div>
    );
  }
  if (rules.isError) {
    return (
      <QueryError
        title="Impossible de charger les horaires"
        error={rules.error}
        onRetry={() => rules.refetch()}
      />
    );
  }
  return <HoursEditor resourceId={resourceId} initial={rules.data.rules} />;
}

function HoursEditor({ resourceId, initial }: { resourceId: string; initial: AvailabilityRule[] }) {
  const replace = useReplaceRules(resourceId);
  const form = useForm<ReplaceRulesInput>({
    // Le même schéma que l'API, appliqué après conversion de 00:00 en 24:00.
    resolver: (values, context, options) =>
      zodResolver(replaceRulesSchema)({ rules: toApi(values.rules) }, context, options),
    defaultValues: { rules: toForm(initial) },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'rules' });
  const { errors, isDirty } = form.formState;

  function onSubmit(values: ReplaceRulesInput) {
    replace.mutate(values, {
      onSuccess: (saved) => {
        form.reset({ rules: toForm(saved.rules) });
        toast.success('Horaires enregistrés.');
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <ul className="divide-y">
        {WEEKDAYS.map((label, dayIndex) => {
          const weekday = dayIndex + 1;
          const ranges = fields
            .map((field, index) => ({ field, index }))
            .filter(({ field }) => field.weekday === weekday);
          return (
            <li
              key={label}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4"
            >
              <span className="flex h-11 w-28 shrink-0 items-center font-medium">{label}</span>
              <div className="flex flex-1 flex-col gap-2">
                {ranges.length === 0 && (
                  <span className="text-muted-foreground flex h-11 items-center">Fermé</span>
                )}
                {ranges.map(({ field, index }, position) => {
                  const error = errors.rules?.[index];
                  const name = `${label}, plage ${position + 1}`;
                  return (
                    <div key={field.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          className="w-auto"
                          aria-label={`${name} : début`}
                          aria-invalid={!!error?.startTime}
                          {...form.register(`rules.${index}.startTime`)}
                        />
                        <span aria-hidden className="text-muted-foreground">
                          –
                        </span>
                        <Input
                          type="time"
                          className="w-auto"
                          aria-label={`${name} : fin`}
                          aria-invalid={!!error?.endTime}
                          {...form.register(`rules.${index}.endTime`)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="size-11"
                          aria-label={`Supprimer ${name}`}
                          onClick={() => remove(index)}
                        >
                          <X aria-hidden className="size-4" />
                        </Button>
                      </div>
                      <FieldError errors={[error?.startTime, error?.endTime]} />
                    </div>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-fit"
                aria-label={`Ajouter une plage le ${label.toLowerCase()}`}
                onClick={() => append({ weekday, startTime: '09:00', endTime: '18:00' })}
              >
                <Plus aria-hidden className="size-4" />
                Ajouter une plage
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground">
        Heures locales de la ressource. Pour fermer à minuit, indiquez 00:00 comme heure de fin.
      </p>
      <Button type="submit" className="h-11 sm:w-fit" disabled={!isDirty || replace.isPending}>
        {replace.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
        Enregistrer les horaires
      </Button>
    </form>
  );
}
