'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { type LoginInput, loginSchema } from '@creno/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiClientError, errorMessage } from '@/lib/api/errors';
import { afterLoginPath } from '@/lib/safe-next';
import { useLogin } from '../api';

/** `next` : destination demandée par la page d'origine (`?next=`), validée avant usage. */
export function LoginForm({ next }: { next: string | undefined }) {
  const router = useRouter();
  const login = useLogin();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;

  function onSubmit(values: LoginInput) {
    login.mutate(values, {
      onSuccess: ({ user }) => {
        router.push(afterLoginPath(next, user.role));
        router.refresh();
      },
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {login.isError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>
              <p>{errorMessage(login.error)}</p>
              {/* Une inscription pas encore terminée n'a pas de compte : même erreur qu'un mauvais mot de passe. */}
              {login.error instanceof ApiClientError &&
                login.error.code === 'INVALID_CREDENTIALS' && (
                  <p>
                    Inscription en cours ? Terminez-la d&apos;abord avec le lien reçu par email : le
                    compte n&apos;existe qu&apos;ensuite.
                  </p>
                )}
            </AlertDescription>
          </Alert>
        )}
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
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...form.register('password')}
          />
          <FieldError errors={[errors.password]} />
        </Field>
        <Button type="submit" className="h-11" disabled={login.isPending}>
          {login.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          Se connecter
        </Button>
      </FieldGroup>
    </form>
  );
}
