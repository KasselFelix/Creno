'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { completeRegistrationSchema, PASSWORD_MIN_LENGTH } from '@creno/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError, errorMessage } from '@/lib/api/errors';
import { homeFor } from '@/lib/safe-next';
import { useCompleteRegistration } from '../api';

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

/** Le jeton vient du lien, pas du formulaire. */
const profileSchema = completeRegistrationSchema.omit({ token: true });
type ProfileInput = z.infer<typeof profileSchema>;

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/**
 * Le jeton arrive dans le fragment de l'URL (`#…`), que le navigateur n'envoie jamais au serveur :
 * il n'existe donc que côté client. `null` pendant le rendu serveur et l'hydratation.
 */
function useHashToken(): string | null {
  return useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash.slice(1),
    () => null,
  );
}

function InvalidLink() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Lien invalide ou expiré</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>
            Ce lien d&apos;inscription a déjà servi, a expiré, ou est incomplet. Si votre compte est
            déjà créé, connectez-vous ; sinon, refaites une demande pour recevoir un nouveau lien.
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 sm:flex-row">
        <Link href="/register" className={buttonVariants({ className: 'h-11 w-full sm:flex-1' })}>
          Recevoir un nouveau lien
        </Link>
        <Link
          href="/login"
          className={buttonVariants({ variant: 'outline', className: 'h-11 w-full sm:flex-1' })}
        >
          Se connecter
        </Link>
      </CardFooter>
    </Card>
  );
}

export function CompleteRegistrationCard() {
  const router = useRouter();
  const token = useHashToken();
  const completion = useCompleteRegistration();
  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    mode: 'onTouched',
    defaultValues: { password: '', fullName: '', role: 'customer' },
  });
  const { errors } = form.formState;

  function onSubmit(values: ProfileInput) {
    if (!token) return;
    completion.mutate(
      { ...values, token },
      {
        onSuccess: ({ user }) => {
          // `replace` : le jeton a servi, il ne reste pas dans l'historique.
          router.replace(homeFor(user.role));
          router.refresh();
        },
      },
    );
  }

  const linkRefused =
    completion.error instanceof ApiClientError &&
    completion.error.code === 'REGISTRATION_LINK_INVALID';
  if (token === '' || linkRefused) return <InvalidLink />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Terminez votre inscription</h1>
        </CardTitle>
        <CardDescription>Dernière étape : votre profil et votre mot de passe.</CardDescription>
      </CardHeader>
      <CardContent>
        {token === null ? (
          <div className="flex flex-col gap-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              {completion.isError && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden />
                  <AlertDescription>{errorMessage(completion.error)}</AlertDescription>
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
              <Button type="submit" className="h-11" disabled={completion.isPending}>
                {completion.isPending && (
                  <LoaderCircle aria-hidden className="size-4 animate-spin" />
                )}
                Créer mon compte
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
