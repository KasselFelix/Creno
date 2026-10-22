'use client';

import { cn } from 'cn';
import { useTheme } from 'next-themes';
import { useState, useSyncExternalStore } from 'react';
import styles from './theme-toggle.module.css';

const STAR_PATH =
  'M 0 10 C 10 10, 10 10, 0 10 C 10 10, 10 10, 10 20 C 10 10, 10 10, 20 10 C 10 10, 10 10, 10 0 C 10 10, 10 10, 0 10 Z';

const subscribeNothing = () => () => {};

/**
 * Interrupteur jour/nuit animé. Le dessin suit la classe `dark` de <html> (CSS) ; l'état exposé aux
 * lecteurs d'écran (`role="switch"`, `aria-checked`) n'est posé qu'une fois monté, le serveur ne
 * connaissant pas le thème.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const [switching, setSwitching] = useState<'to-dark' | 'to-light' | undefined>();

  function toggle() {
    // La classe de <html> fait foi : c'est elle que suit le dessin.
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    setSwitching(next === 'dark' ? 'to-dark' : 'to-light');
    setTheme(next);
  }

  return (
    <button
      type="button"
      className={cn(styles.toggle, className)}
      aria-label="Thème sombre"
      role={mounted ? 'switch' : undefined}
      aria-checked={mounted ? resolvedTheme === 'dark' : undefined}
      data-switching={switching}
      onClick={toggle}
    >
      <span aria-hidden className={styles.track}>
        <span className={styles.thumb}>
          <span className={styles.ray} />
          <span className={styles.ray} />
          <span className={styles.ray} />
          <span className={styles.crater} />
          <span className={styles.crater} />
          <span className={styles.crater} />
          <span className={styles.clouds}>
            <span className={cn(styles.cloud, styles.cloudBack)} />
            <span className={cn(styles.cloud, styles.cloudBack)} />
            <span className={cn(styles.cloud, styles.cloudBack)} />
            <span className={styles.cloud} />
            <span className={styles.cloud} />
            <span className={styles.cloud} />
          </span>
        </span>
        <span className={styles.stars}>
          {[0, 1, 2, 3].map((star) => (
            <svg key={star} className={styles.star} viewBox="0 0 20 20">
              <path d={STAR_PATH} />
            </svg>
          ))}
        </span>
      </span>
    </button>
  );
}
