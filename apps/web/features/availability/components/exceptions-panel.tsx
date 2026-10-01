'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { type CreateExceptionInput, createExceptionSchema } from '@creno/shared';
import { QueryError } from '@/components/query-error';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api/errors';
import { dateTimeInZone } from '@/lib/format';
import { useCreateException, useDeleteException, useExceptions } from '../api';

export function ExceptionsPanel({
  resourceId,
  timezone,
}: {
  resourceId: string;
  timezone: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ExceptionsList resourceId={resourceId} timezone={timezone} />
      <ExceptionForm resourceId={resourceId} />
    </div>
  );
}

function ExceptionsList({ resourceId, timezone }: { resourceId: string; timezone: string }) {
  const exceptions = useExceptions(resourceId);
  const remove = useDeleteException(resourceId);

  if (exceptions.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <Skeleton className="h-11 w-full" />
        <span className="sr-only">Chargement des fermetures…</span>
      </div>
    );
  }
  if (exceptions.isError) {
    return (
      <QueryError
        title="Impossible de charger les fermetures"
        error={exceptions.error}
        onRetry={() => exceptions.refetch()}
      />
    );
  }
  if (exceptions.data.items.length === 0) {
    return <p className="text-muted-foreground">Aucune fermeture à venir.</p>;
  }

  function handleDelete(exceptionId: string) {
    remove.mutate(exceptionId, {
      onSuccess: () => toast.success('Fermeture supprimée.'),
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <ul className="divide-y">
      {exceptions.data.items.map((exception) => {
        const range = `${dateTimeInZone(exception.start, timezone)} → ${dateTimeInZone(exception.end, timezone)}`;
        return (
          <li
            key={exception.id}
            className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{range}</span>
              {exception.reason && (
                <span className="text-muted-foreground truncate">{exception.reason}</span>
              )}
            </div>
            <Button
              variant="ghost"
              className="size-11 shrink-0"
              aria-label={`Supprimer la fermeture du ${range}`}
              disabled={remove.isPending && remove.variables === exception.id}
              onClick={() => handleDelete(exception.id)}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function ExceptionForm({ resourceId }: { resourceId: string }) {
  const create = useCreateException(resourceId);
  const form = useForm<CreateExceptionInput>({
    resolver: zodResolver(createExceptionSchema),
    defaultValues: { startLocal: '', endLocal: '', reason: '' },
  });
  const { errors } = form.formState;

  function onSubmit(values: CreateExceptionInput) {
    create.mutate(values, {
      onSuccess: () => {
        form.reset();
        toast.success('Fermeture ajoutée.');
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!errors.startLocal}>
            <FieldLabel htmlFor="exception-start">Début</FieldLabel>
            <Input
              id="exception-start"
              type="datetime-local"
              aria-invalid={!!errors.startLocal}
              {...form.register('startLocal')}
            />
            <FieldError errors={[errors.startLocal]} />
          </Field>
          <Field data-invalid={!!errors.endLocal}>
            <FieldLabel htmlFor="exception-end">Fin</FieldLabel>
            <Input
              id="exception-end"
              type="datetime-local"
              aria-invalid={!!errors.endLocal}
              {...form.register('endLocal')}
            />
            <FieldError errors={[errors.endLocal]} />
          </Field>
        </div>
        <Field data-invalid={!!errors.reason}>
          <FieldLabel htmlFor="exception-reason">
            Motif (facultatif, visible de vous seul)
          </FieldLabel>
          <Input
            id="exception-reason"
            placeholder="Congés, travaux…"
            aria-invalid={!!errors.reason}
            {...form.register('reason')}
          />
          <FieldError errors={[errors.reason]} />
        </Field>
        <Button
          type="submit"
          variant="outline"
          className="h-11 sm:w-fit"
          disabled={create.isPending}
        >
          {create.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          Ajouter la fermeture
        </Button>
      </FieldGroup>
    </form>
  );
}
