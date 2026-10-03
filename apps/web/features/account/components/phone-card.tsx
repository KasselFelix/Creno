'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  PHONE_CODE_LENGTH,
  type RequestPhoneCodeInput,
  requestPhoneCodeSchema,
  type VerifyPhoneInput,
  verifyPhoneSchema,
} from '@creno/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiClientError, errorMessage } from '@/lib/api/errors';
import { formatPhone, timeInZone } from '@/lib/format';
import { useRemovePhone, useRequestPhoneCode, useVerifyPhone } from '../api';

/** Le plafond des codes est horaire : le message générique (« dans une minute ») serait faux. */
function phoneErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'TOO_MANY_REQUESTS') {
    return 'Trop de codes demandés. Réessayez dans une heure.';
  }
  return errorMessage(error);
}

function ErrorAlert({ error }: { error: unknown }) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{phoneErrorMessage(error)}</AlertDescription>
    </Alert>
  );
}

type Step =
  { kind: 'idle' } | { kind: 'editing' } | { kind: 'code-sent'; phone: string; expiresAt: string };

/**
 * Numéro de téléphone du compte. Il n'est enregistré qu'après la saisie du code reçu par SMS :
 * un numéro affiché ici est toujours vérifié.
 */
export function PhoneCard({ phone }: { phone: string | null }) {
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  if (step.kind === 'code-sent') {
    return (
      <CodeForm
        phone={step.phone}
        expiresAt={step.expiresAt}
        onResent={(expiresAt) => setStep({ ...step, expiresAt })}
        onChangeNumber={() => setStep({ kind: 'editing' })}
        onVerified={() => setStep({ kind: 'idle' })}
      />
    );
  }
  if (!phone || step.kind === 'editing') {
    return (
      <PhoneForm
        defaultPhone={step.kind === 'editing' ? '' : (phone ?? '')}
        current={phone}
        onCodeSent={(sentTo, expiresAt) => setStep({ kind: 'code-sent', phone: sentTo, expiresAt })}
        onCancel={phone ? () => setStep({ kind: 'idle' }) : undefined}
      />
    );
  }
  return <VerifiedPhone phone={phone} onChange={() => setStep({ kind: 'editing' })} />;
}

function VerifiedPhone({ phone, onChange }: { phone: string; onChange: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const remove = useRemovePhone();

  function confirmRemove() {
    remove.mutate(undefined, {
      onSuccess: () => {
        setOpen(false);
        toast.success('Numéro retiré.');
        router.refresh();
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium tabular-nums">{formatPhone(phone)}</span>
        <Badge variant="secondary">
          <ShieldCheck aria-hidden />
          Vérifié
        </Badge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="outline" className="h-11" onClick={onChange}>
          Changer de numéro
        </Button>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button variant="ghost" className="h-11" />}>
            Retirer
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Retirer ce numéro ?</AlertDialogTitle>
              <AlertDialogDescription>
                Vous ne recevrez plus de rappel par SMS. Les rappels par email continuent.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11" disabled={remove.isPending}>
                Garder ce numéro
              </AlertDialogCancel>
              <Button
                variant="destructive"
                className="h-11"
                onClick={confirmRemove}
                disabled={remove.isPending}
              >
                {remove.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
                Retirer le numéro
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function PhoneForm({
  defaultPhone,
  current,
  onCodeSent,
  onCancel,
}: {
  defaultPhone: string;
  current: string | null;
  onCodeSent: (phone: string, expiresAt: string) => void;
  onCancel?: () => void;
}) {
  const requestCode = useRequestPhoneCode();
  const form = useForm<RequestPhoneCodeInput>({
    resolver: zodResolver(requestPhoneCodeSchema),
    defaultValues: { phone: defaultPhone },
  });
  const { errors } = form.formState;

  function onSubmit(values: RequestPhoneCodeInput) {
    if (values.phone === current) {
      onCancel?.();
      return;
    }
    requestCode.mutate(values, {
      onSuccess: ({ expiresAt }) => onCodeSent(values.phone, expiresAt),
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.phone}>
          <FieldLabel htmlFor="account-phone">
            {current ? 'Nouveau numéro' : 'Numéro de mobile'}
          </FieldLabel>
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
            Format international. Nous vous envoyons un code par SMS pour vérifier ce numéro.
            {current && ` L'actuel (${formatPhone(current)}) reste actif d'ici là.`}
          </FieldDescription>
          <FieldError errors={[errors.phone]} />
        </Field>
        {requestCode.isError && <ErrorAlert error={requestCode.error} />}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="submit" className="h-11" disabled={requestCode.isPending}>
            {requestCode.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            Recevoir un code
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
              Annuler
            </Button>
          )}
        </div>
      </FieldGroup>
    </form>
  );
}

function CodeForm({
  phone,
  expiresAt,
  onResent,
  onChangeNumber,
  onVerified,
}: {
  phone: string;
  expiresAt: string;
  onResent: (expiresAt: string) => void;
  onChangeNumber: () => void;
  onVerified: () => void;
}) {
  const router = useRouter();
  const verify = useVerifyPhone();
  const resend = useRequestPhoneCode();
  const form = useForm<VerifyPhoneInput>({
    resolver: zodResolver(verifyPhoneSchema),
    defaultValues: { code: '' },
  });
  const { errors } = form.formState;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function onSubmit(values: VerifyPhoneInput) {
    verify.mutate(values, {
      onSuccess: () => {
        toast.success('Numéro vérifié.');
        onVerified();
        router.refresh();
      },
      onError: () => form.setValue('code', ''),
    });
  }

  function onResend() {
    verify.reset();
    resend.mutate(
      { phone },
      {
        onSuccess: ({ expiresAt: next }) => {
          onResent(next);
          toast.success('Nouveau code envoyé.');
        },
      },
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <p className="text-sm" aria-live="polite">
          Code envoyé au <span className="font-medium tabular-nums">{formatPhone(phone)}</span>,
          valable jusqu&apos;à {timeInZone(expiresAt, timeZone)}.
        </p>
        <Field data-invalid={!!errors.code}>
          <FieldLabel htmlFor="account-phone-code">Code à {PHONE_CODE_LENGTH} chiffres</FieldLabel>
          <Input
            id="account-phone-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={PHONE_CODE_LENGTH}
            className="max-w-40 tracking-widest tabular-nums"
            aria-invalid={!!errors.code}
            autoFocus
            {...form.register('code')}
          />
          <FieldError errors={[errors.code]} />
        </Field>
        {verify.isError && <ErrorAlert error={verify.error} />}
        {resend.isError && <ErrorAlert error={resend.error} />}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="submit" className="h-11" disabled={verify.isPending}>
            {verify.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            Vérifier
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={onResend}
            disabled={resend.isPending}
          >
            {resend.isPending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
            Renvoyer un code
          </Button>
          <Button type="button" variant="ghost" className="h-11" onClick={onChangeNumber}>
            Changer de numéro
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
