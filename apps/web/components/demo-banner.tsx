import { Info } from 'lucide-react';
import { publicEnv } from '@/lib/env';

const DEMO_ACCOUNTS_URL = 'https://github.com/KasselFelix/Creno#d%C3%A9mo-en-ligne';

/** Rappel permanent sur la démo publique : paiements de test, serveur qui se met en veille. */
export function DemoBanner() {
  if (!publicEnv.NEXT_PUBLIC_DEMO_MODE) return null;
  const notice = (
    <>
      {/* Assez court pour tenir sur une ligne dès 1024 px, où le défilement s'arrête. */}
      <strong className="text-foreground font-medium">Démo</strong> : paiements de test (carte 4242
      4242 4242 4242). Serveur en veille sans visite : la première recherche prend ~20 s.
    </>
  );
  return (
    <div className="bg-muted text-muted-foreground border-b text-xs sm:text-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4">
        <Info aria-hidden className="size-4 shrink-0" />
        {/* Une seule ligne : sous 1024 px le texte défile (pause au survol ou au focus, aucun
            mouvement avec prefers-reduced-motion, où il se fait défiler à la main). */}
        <div className="marquee min-w-0 flex-1 overflow-hidden whitespace-nowrap motion-reduce:overflow-x-auto lg:whitespace-normal">
          <p className="marquee-track inline-flex gap-12 lg:flex">
            <span>{notice}</span>
            <span aria-hidden className="lg:hidden">
              {notice}
            </span>
          </p>
        </div>
        <a
          href={DEMO_ACCOUNTS_URL}
          className="hover:text-foreground inline-flex min-h-11 shrink-0 items-center underline underline-offset-4"
          rel="noopener"
        >
          Comptes de démo
        </a>
      </div>
    </div>
  );
}
