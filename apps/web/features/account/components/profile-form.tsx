'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { fullNameSchema, type PublicUser } from '@creno/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/errors';
import { useUpdateMe } from '@/features/auth/api';

// Mêmes règles que l'API. Le téléphone a sa propre carte : il se vérifie par un code SMS.
const profileFormSchema = z.object({ fullName: fullNameSchema });
type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function ProfileForm({ user }: { user: PublicUser }) {
  const router = useRouter();
  const updateMe = useUpdateMe();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { fullName: user.fullName },
  });
  const { errors, isDirty } = form.formState;

  function onSubmit(values: ProfileFormValues) {
    updateMe.mutate(
      { fullName: values.fullName },
      {
        onSuccess: (updated) => {
          form.reset({ fullName: updated.fullName });
          toast.success('Profil mis à jour.');
          router.refresh();
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="account-email">Email</FieldLabel>
          <Input id="account-email" value={user.email} readOnly disabled />
        </Field>
        <Field data-invalid={!!errors.fullName}>
          <FieldLabel htmlFor="account-fullName">Nom complet</FieldLabel>
          <Input
            id="account-fullName"
            autoComplete="name"
            aria-invalid={!!errors.fullName}
            {...form.register('fullName')}
          />
          <FieldError errors={[errors.fullName]} />
        </Field>
        <Button type="submit" className="h-11 sm:w-fit" disabled={!isDirty || updateMe.isPending}>
          {updateMe.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          Enregistrer
        </Button>
      </FieldGroup>
    </form>
  );
}
