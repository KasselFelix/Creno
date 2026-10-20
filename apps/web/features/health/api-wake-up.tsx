'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import {
  isWaking,
  pingApi,
  useApiWake,
  WAKING_NOTICE_AFTER_MS,
  wakeProgress,
} from '@/lib/api/wake';

const TOAST_ID = 'api-waking';
/** Activités qui montrent un visiteur présent : de quoi garder l'API éveillée pour lui. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Garde l'API éveillée tant que le visiteur est là : ping au chargement, puis à chaque activité si
 * l'API n'a pas répondu depuis 4 min (elle dort après 5). Affiche l'avis de réveil quand le visiteur
 * attend une réponse pendant un réveil. Sans rendu ; monté une fois dans le layout racine.
 */
export function ApiWakeUp() {
  useEffect(() => {
    pingApi();
    const onActivity = () => {
      if (document.visibilityState === 'visible') pingApi();
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', onActivity);
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', onActivity);
    };
  }, []);

  const state = useApiWake();
  const watching = state.requests > 0 && state.wakingSince !== null;
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [watching]);

  const since = watching && isWaking(state, now) ? state.wakingSince : null;
  useWakingToast(since);
  return null;
}

/**
 * Attente d'un rendu serveur (fiche ouverte par un lien direct) : au bout de 2 s, l'API sort de veille.
 * À placer dans un `loading.tsx`, l'avis se ferme quand la page arrive.
 */
export function ServerWaitNotice() {
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    const start = Date.now();
    const timer = setTimeout(() => setSince(start), WAKING_NOTICE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  useWakingToast(since);
  return null;
}

/** Ouvre l'avis tant que `since` (début du réveil) est connu, le ferme sinon. */
function useWakingToast(since: number | null) {
  useEffect(() => {
    if (since === null) return;
    toast.custom(() => <WakingNotice since={since} />, { id: TOAST_ID, duration: Infinity });
    return () => {
      toast.dismiss(TOAST_ID);
    };
  }, [since]);
}

function WakingNotice({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-popover text-popover-foreground flex w-full flex-col gap-3 rounded-lg border p-4 shadow-lg">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden
          className="text-lg font-semibold tracking-tight motion-safe:animate-pulse"
        >
          Creno
        </span>
        <p className="text-sm font-medium">Le serveur de démo se réveille</p>
      </div>
      <p className="text-muted-foreground text-sm">
        Il se met en veille quand personne ne l&apos;utilise, pour rester gratuit. Comptez une
        vingtaine de secondes : la page continue toute seule.
      </p>
      <Progress value={Math.round(wakeProgress(since, now))}>
        <ProgressLabel className="sr-only">Réveil du serveur</ProgressLabel>
      </Progress>
    </div>
  );
}
