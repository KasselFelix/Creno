'use client';

import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function ProviderError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10">
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>Impossible d&apos;afficher cette fiche</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          Le service est momentanément indisponible.
          <Button variant="outline" className="h-11" onClick={reset}>
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  );
}
