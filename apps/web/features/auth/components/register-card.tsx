'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EMAIL_VERIFICATION_TTL_HOURS } from '@creno/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { RegisterForm } from './register-form';

/**
 * Inscription en deux temps : le formulaire, puis « vérifiez votre boîte mail ». Le second écran
 * est le même que l'adresse ait déjà un compte ou non : c'est l'email reçu qui fait la différence.
 */
export function RegisterCard() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const sentTitle = useRef<HTMLHeadingElement>(null);

  // Le contenu de la carte change sans navigation : le focus suit, pour les lecteurs d'écran.
  useEffect(() => {
    if (sentTo) sentTitle.current?.focus();
  }, [sentTo]);

  if (sentTo) {
    return (
      <Card>
        <CardHeader>
          <MailCheck aria-hidden className="text-primary size-8" />
          <CardTitle>
            <h1 ref={sentTitle} tabIndex={-1} className="outline-none">
              Vérifiez votre boîte mail
            </h1>
          </CardTitle>
          <CardDescription>
            Nous avons envoyé un email à{' '}
            <span className="text-foreground font-medium break-all">{sentTo}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground flex flex-col gap-2 text-sm">
          <p>
            Ouvrez-le et suivez le lien pour terminer l&apos;inscription. Il est valable{' '}
            {EMAIL_VERIFICATION_TTL_HOURS} heures.
          </p>
          <p>Rien reçu au bout de quelques minutes ? Regardez dans les indésirables.</p>
        </CardContent>
        <CardFooter>
          <Button variant="outline" className="h-11 w-full" onClick={() => setSentTo(null)}>
            Modifier l&apos;adresse ou recommencer
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Créer un compte</h1>
        </CardTitle>
        <CardDescription>Gratuit, en moins d&apos;une minute.</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm onSent={setSentTo} />
      </CardContent>
      <CardFooter className="text-muted-foreground text-sm">
        <p>
          Déjà inscrit ?{' '}
          <Link href="/login" className="text-foreground font-medium underline underline-offset-4">
            Se connecter
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
