'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { type RegisterInput, registerSchema } from '@creno/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiClientError, errorMessage } from '@/lib/api/errors';
import { useRegister } from '../api';

/** `onSent` : la demande est acceptée, un email part vers l'adresse saisie. */
export function RegisterForm({ onSent }: { onSent: (email: string) => void }) {
  const registerUser = useRegister();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  });
  const { errors } = form.formState;

  function onSubmit(values: RegisterInput) {
    registerUser.mutate(values, {
      onSuccess: () => onSent(values.email),
      onError: (error) => {
        const message = error instanceof ApiClientError ? error.fieldErrors.email?.[0] : undefined;
        if (message) form.setError('email', { message });
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
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? undefined : 'email-help'}
            {...form.register('email')}
          />
          {!errors.email && (
            <FieldDescription id="email-help">
              Vous choisirez votre mot de passe depuis le lien que nous vous envoyons.
            </FieldDescription>
          )}
          <FieldError errors={[errors.email]} />
        </Field>
        <Button type="submit" className="h-11" disabled={registerUser.isPending}>
          {registerUser.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          Recevoir le lien d&apos;inscription
        </Button>
      </FieldGroup>
    </form>
  );
}
