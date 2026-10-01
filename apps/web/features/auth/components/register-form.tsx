'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { PASSWORD_MIN_LENGTH, type RegisterInput, registerSchema } from '@creno/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ApiClientError, errorMessage } from '@/lib/api/errors';
import { DEFAULT_AFTER_LOGIN } from '@/lib/safe-next';
import { useRegister } from '../api';

const roles = [
  {
    value: 'customer',
    title: 'Je veux réserver',
    description: 'Trouver un prestataire et réserver un créneau.',
  },
  {
    value: 'provider',
    title: 'Je propose mes services',
    description: 'Publier mes disponibilités et être payé en ligne.',
  },
] as const;

export function RegisterForm() {
  const router = useRouter();
  const registerUser = useRegister();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', fullName: '', role: 'customer' },
  });
  const { errors } = form.formState;

  function onSubmit(values: RegisterInput) {
    registerUser.mutate(values, {
      onSuccess: () => {
        router.push(DEFAULT_AFTER_LOGIN);
        router.refresh();
      },
      onError: (error) => {
        // Les erreurs par champ de l'API (ex. email déjà pris) s'affichent sous le champ concerné.
        if (!(error instanceof ApiClientError)) return;
        for (const field of ['email', 'password', 'fullName', 'role'] as const) {
          const message = error.fieldErrors[field]?.[0];
          if (message) form.setError(field, { message });
        }
      },
    });
  }

  const hasFieldError =
    registerUser.error instanceof ApiClientError &&
    Object.keys(registerUser.error.fieldErrors).length > 0;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {registerUser.isError && !hasFieldError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{errorMessage(registerUser.error)}</AlertDescription>
          </Alert>
        )}
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">Vous êtes ici pour…</FieldLegend>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid gap-3 sm:grid-cols-2"
              >
                {roles.map((role) => (
                  <FieldLabel key={role.value} htmlFor={`role-${role.value}`}>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>{role.title}</FieldTitle>
                        <FieldDescription>{role.description}</FieldDescription>
                      </FieldContent>
                      <RadioGroupItem id={`role-${role.value}`} value={role.value} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
        />
        <Field data-invalid={!!errors.fullName}>
          <FieldLabel htmlFor="fullName">Nom complet</FieldLabel>
          <Input
            id="fullName"
            autoComplete="name"
            aria-invalid={!!errors.fullName}
            {...form.register('fullName')}
          />
          <FieldError errors={[errors.fullName]} />
        </Field>
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register('email')}
          />
          <FieldError errors={[errors.email]} />
        </Field>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Mot de passe</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? undefined : 'password-rule'}
            {...form.register('password')}
          />
          {/* La règle n'est pas répétée quand elle s'affiche déjà comme erreur. */}
          {!errors.password && (
            <FieldDescription id="password-rule">
              {PASSWORD_MIN_LENGTH} caractères minimum.
            </FieldDescription>
          )}
          <FieldError errors={[errors.password]} />
        </Field>
        <Button type="submit" className="h-11" disabled={registerUser.isPending}>
          {registerUser.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          Créer mon compte
        </Button>
      </FieldGroup>
    </form>
  );
}
