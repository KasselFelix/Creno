'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { fullNameSchema, phoneSchema, type PublicUser } from '@creno/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/errors';
import { useUpdateMe } from '@/features/auth/api';

// Mêmes règles que l'API ; un champ téléphone vide signifie « pas de téléphone ».
const profileFormSchema = z.object({
  fullName: fullNameSchema,
  phone: z.union([z.literal(''), phoneSchema]),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function ProfileForm({ user }: { user: PublicUser }) {
  const router = useRouter();
  const updateMe = useUpdateMe();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { fullName: user.fullName, phone: user.phone ?? '' },
  });
  const { errors, isDirty } = form.formState;

  function onSubmit(values: ProfileFormValues) {
    updateMe.mutate(
      { fullName: values.fullName, phone: values.phone === '' ? null : values.phone },
      {
        onSuccess: (updated) => {
          form.reset({ fullName: updated.fullName, phone: updated.phone ?? '' });
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
        <Field data-invalid={!!errors.phone}>
          <FieldLabel htmlFor="account-phone">Téléphone</FieldLabel>
          <Input
            id="account-phone"
            type="tel"
            autoComplete="tel"
            placeholder="+33612345678"
            aria-invalid={!!errors.phone}
            aria-describedby="account-phone-help"
            {...form.register('phone')}
          />
          <FieldDescription id="account-phone-help">
            Format international. Sert au rappel par SMS, la veille de vos réservations.
          </FieldDescription>
          <FieldError errors={[errors.phone]} />
        </Field>
        <Button type="submit" className="h-11 sm:w-fit" disabled={!isDirty || updateMe.isPending}>
          {updateMe.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
          Enregistrer
        </Button>
      </FieldGroup>
    </form>
  );
}
