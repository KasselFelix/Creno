'use client';

import { cn } from 'cn';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './creno-loader.module.css';

/** Rythme choisi sur le prototype : 0,85 s par tour de page, 0,35 s sur chaque jour. */
const TURN_MS = 850;
const PAUSE_MS = 350;
/** Animation de fin (≈ 4,4 s) : dernière page, coche, nom, puis fondu (durées CSS assorties). */
const END = { flip: 840, check: 780, letterDelay: 180, letterStagger: 135, hold: 1950, fade: 750 };
const WORD = 'Creno';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Jours du mois en cours, en boucle : après le 31 octobre vient le 1er. */
function nextDay(day: number): number {
  const today = new Date();
  const monthLength = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return (day % monthLength) + 1;
}

/** La page du dessus monte, passe au-dessus des anneaux (on voit son dos), puis retombe derrière. */
function turnPage(flipper: HTMLElement, duration: number): Animation {
  return flipper.animate(
    [
      { transform: 'rotateX(0deg)', easing: 'cubic-bezier(.3,0,.25,1)' },
      { transform: 'rotateX(180deg)', offset: 0.6, easing: 'cubic-bezier(.55,0,1,.45)' },
      { transform: 'rotateX(270deg)' },
    ],
    { duration, fill: 'forwards' },
  );
}

/**
 * Écran de chargement plein écran : le calendrier du logo tourne ses pages, du jour présent au
 * suivant, tant que `finishing` est faux. Ensuite : dernière page vierge, la coche s'y dessine, le
 * nom se met en place, l'écran s'efface et `onDone` est appelé. Aucun texte visible.
 */
export function CrenoLoader({ finishing, onDone }: { finishing: boolean; onDone: () => void }) {
  const flipperRef = useRef<HTMLDivElement>(null);
  const checkRef = useRef<SVGPathElement>(null);
  const todayRef = useRef<HTMLSpanElement>(null);
  const nextRef = useRef<HTMLSpanElement>(null);
  const finishingRef = useRef(finishing);
  const onDoneRef = useRef(onDone);
  const screenRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'turning' | 'named' | 'gone'>('turning');
  // Rempli juste après l'ouverture : une région annoncée déjà pleine au montage n'est pas toujours lue.
  const [announced, setAnnounced] = useState(false);

  useEffect(() => {
    finishingRef.current = finishing;
    onDoneRef.current = onDone;
  }, [finishing, onDone]);

  // La page dessous devient inerte (ni clavier ni lecteur d'écran) tant que l'écran la couvre :
  // Entrée dans le champ de recherche ne relance rien.
  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const covered = [...document.body.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== screen && !element.inert,
    );
    for (const element of covered) element.inert = true;
    const timer = setTimeout(() => setAnnounced(true), 100);
    return () => {
      clearTimeout(timer);
      for (const element of covered) element.inert = false;
    };
  }, []);

  useEffect(() => {
    const flipper = flipperRef.current;
    const check = checkRef.current;
    const today = todayRef.current;
    const next = nextRef.current;
    if (!flipper || !check || !today || !next) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cancelled = false;
    // Les numéros sont écrits directement (pas d'état React) : la page revient à plat dans la même
    // image que le changement de jour, sans clignotement.
    let day = new Date().getDate();
    const show = (current: string, below: string) => {
      today.textContent = current;
      next.textContent = below;
    };
    show(String(day), String(nextDay(day)));

    const run = async () => {
      while (!cancelled && !finishingRef.current) {
        await wait(PAUSE_MS);
        if (cancelled || finishingRef.current || reduce) continue;
        const turn = turnPage(flipper, TURN_MS);
        await turn.finished;
        if (cancelled) return;
        day = nextDay(day);
        show(String(day), String(nextDay(day)));
        turn.cancel();
      }
      if (cancelled) return;
      // Fin : dernière page vierge, la coche s'y dessine.
      next.textContent = '';
      if (!reduce) {
        const last = turnPage(flipper, END.flip);
        await last.finished;
        if (cancelled) return;
        last.cancel();
      }
      today.textContent = '';
      if (reduce) check.style.strokeDashoffset = '0';
      else {
        await check.animate([{ strokeDashoffset: '1.1' }, { strokeDashoffset: '0' }], {
          duration: END.check,
          easing: 'cubic-bezier(.3,0,.2,1)',
          fill: 'forwards',
        }).finished;
      }
      if (cancelled) return;
      // Le nom se met en place à côté du calendrier, puis l'écran s'efface.
      setPhase('named');
      await wait(reduce ? 300 : END.hold);
      if (cancelled) return;
      setPhase('gone');
      await wait(reduce ? 0 : END.fade);
      if (!cancelled) onDoneRef.current();
    };

    run().catch((error: unknown) => {
      // Démontage pendant une animation : son abandon est voulu.
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    });
    return () => {
      cancelled = true;
      flipper.getAnimations().forEach((animation) => animation.cancel());
      check.getAnimations().forEach((animation) => animation.cancel());
    };
  }, []);

  // Rendu directement dans <body> : tout le reste de la page peut devenir inerte.
  return createPortal(
    <div
      ref={screenRef}
      role="status"
      className={cn(styles.screen, phase === 'gone' && styles.gone)}
    >
      <span className="sr-only">{announced ? 'Chargement…' : ''}</span>
      <div className={styles.lockup} aria-hidden>
        <div className={styles.calendar}>
          <div className={styles.stack}>
            <div className={styles.sheet}>
              <span className={styles.notch} />
              <span className={styles.notch} />
              <span ref={nextRef} className={styles.day} />
            </div>
            <div ref={flipperRef} className={styles.flipper}>
              <div className={cn(styles.sheet, styles.face)}>
                <span className={styles.notch} />
                <span className={styles.notch} />
                <span ref={todayRef} className={styles.day} />
              </div>
              <div className={cn(styles.sheet, styles.face, styles.back)}>
                <span className={styles.notch} />
                <span className={styles.notch} />
              </div>
            </div>
          </div>
          <svg className={styles.check} viewBox="0 0 32 32">
            <path ref={checkRef} pathLength={1} d="M10 20 14.5 24.5 22.5 16" />
          </svg>
          <span className={styles.ring} />
          <span className={styles.ring} />
        </div>
        <span className={cn(styles.word, phase !== 'turning' && styles.wordOpen)}>
          {WORD.split('').map((letter, index) => (
            <span
              key={index}
              style={{ animationDelay: `${END.letterDelay + index * END.letterStagger}ms` }}
            >
              {letter}
            </span>
          ))}
        </span>
      </div>
    </div>,
    document.body,
  );
}
