'use client';

import { useEffect, useState } from 'react';
import { CrenoLoader } from '@/components/creno-loader';
import {
  holdScreen,
  isWaking,
  pingApi,
  SCREEN_AFTER_MS,
  useApiWake,
  wakeProgress,
  wantsScreen,
} from '@/lib/api/wake';

/** Activités qui montrent un visiteur présent : de quoi garder l'API éveillée pour lui. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Garde l'API éveillée tant que le visiteur est là : ping au chargement, puis à chaque activité si
 * l'API n'a pas répondu depuis 4 min (elle dort après 6). Pendant un réveil, affiche la barre de
 * chargement fine ou, pour un changement de page, l'écran de chargement. Monté une fois dans le
 * layout racine, pour que l'écran survive au passage d'une page à l'autre.
 */
export function ApiWakeUp() {
  useEffect(() => {
    // Un onglet ouvert en arrière-plan attend d'être affiché (`visibilitychange`) pour réveiller l'API.
    const onActivity = () => {
      if (document.visibilityState === 'visible') pingApi();
    };
    onActivity();
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
  // Horloge, seulement pendant qu'on attend l'API ou qu'une page la réclame.
  const watching =
    state.serverWaits > 0 || (state.wakingSince !== null && state.requests + state.pageWaits > 0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [watching]);

  // Écran : s'ouvre pendant un réveil, reste tant qu'une page attend, puis joue sa fin.
  const [screen, setScreen] = useState<'off' | 'on' | 'finishing'>('off');
  const holding = state.pageWaits + state.serverWaits > 0;
  if (screen === 'off' && watching && wantsScreen(state, now)) setScreen('on');
  if (screen === 'on' && !holding) setScreen('finishing');

  const bar = screen === 'off' && state.wakingSince !== null && isWaking(state, now);
  return (
    <>
      {bar && <WakeBar progress={wakeProgress(state.wakingSince ?? now, now)} />}
      {screen !== 'off' && (
        <CrenoLoader finishing={screen === 'finishing'} onDone={() => setScreen('off')} />
      )}
    </>
  );
}

/** Barre fine en haut de l'écran : avancement estimé du réveil, sans texte. */
function WakeBar({ progress }: { progress: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Chargement"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      className="fixed inset-x-0 top-0 z-50 h-0.5"
    >
      <div
        className="bg-primary h-full origin-left transition-transform duration-300 motion-reduce:transition-none"
        style={{ transform: `scaleX(${progress / 100})` }}
      />
    </div>
  );
}

/**
 * La page attend l'API (premier chargement, passage de l'accueil à la recherche) : pendant un
 * réveil, l'écran de chargement la couvre au lieu de la barre.
 */
export function useWakingScreen(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return holdScreen('page');
  }, [active]);
}

/**
 * Rendu serveur qui traîne (fiche ouverte par un lien direct, API en veille) : l'écran de
 * chargement au bout de 1,5 s. À placer dans un `loading.tsx` ; l'écran joue sa fin quand la page
 * arrive.
 */
export function ServerWaitScreen() {
  useEffect(() => {
    let release: (() => void) | undefined;
    const timer = setTimeout(() => {
      release = holdScreen('server');
    }, SCREEN_AFTER_MS);
    return () => {
      clearTimeout(timer);
      release?.();
    };
  }, []);
  return null;
}
