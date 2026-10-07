import { Info } from 'lucide-react';
import { publicEnv } from '@/lib/env';

const DEMO_ACCOUNTS_URL = 'https://github.com/KasselFelix/Creno#d%C3%A9mo-en-ligne';

/** Rappel permanent sur la démo publique : paiements de test, serveur qui se met en veille. */
export function DemoBanner() {
  if (!publicEnv.NEXT_PUBLIC_DEMO_MODE) return null;
  return (
    <div className="bg-muted text-muted-foreground border-b text-xs sm:text-sm">
      <p className="mx-auto flex max-w-6xl items-center gap-2 px-4">
        <Info aria-hidden className="size-4 shrink-0" />
        <span>
          <strong className="text-foreground font-medium">Démo</strong> : paiements en mode test
          (carte 4242 4242 4242 4242).{' '}
          <span className="hidden sm:inline">
            Serveur en veille : le premier chargement peut prendre une vingtaine de secondes.{' '}
          </span>
          <a
            href={DEMO_ACCOUNTS_URL}
            className="hover:text-foreground inline-flex min-h-11 items-center underline underline-offset-4"
            rel="noopener"
          >
            Comptes de démo
          </a>
        </span>
      </p>
    </div>
  );
}
