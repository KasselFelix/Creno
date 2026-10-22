'use client';

import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react';
import { useMediaQuery } from '@/lib/use-media-query';

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/**
 * Une animation continue tourne seulement si rien ne l'en empêche : mouvement réduit demandé par le
 * système, onglet caché, élément hors écran ou pause de l'utilisateur.
 */
export function useAnimationRunning(target: RefObject<Element | null>, paused: boolean) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.hidden,
    () => false,
  );
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) =>
      setOnScreen(entry?.isIntersecting ?? true),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);

  return { running: !reduced && !hidden && onScreen && !paused, reduced };
}
