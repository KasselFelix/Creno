'use client';

import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { todayInZone } from '@/lib/format';
import { buildSlotGrid, type SlotGrid } from '../background';
import styles from './home-background.module.css';

const GRID_SEED = 7;
const LIGHT_EVERY_MS = 450;
const LIGHT_FOR_MS = 2600;
/** Les créneaux ne s'allument qu'à l'avant de la grille (les rangées du fond sont effacées). */
const FRONT_FROM_ROW = 3;

const key = (row: number, day: number) => `${row}-${day}`;

/** Créneaux libres de l'avant de la grille, ceux qui peuvent s'allumer. */
function frontFreeCells(grid: SlotGrid): string[] {
  return grid.rows.flatMap((row, rowIndex) =>
    rowIndex < FRONT_FROM_ROW
      ? []
      : row.cells.flatMap((cell, day) => (cell.taken ? [] : [key(rowIndex, day)])),
  );
}

/**
 * Grille de créneaux en perspective : une ou deux semaines à partir du lundi courant, des créneaux
 * pris et des créneaux libres qui s'allument tour à tour. À l'arrêt, les cases allumées restent.
 */
export function HomeSlotGrid({
  dayCount,
  running,
  reduced,
}: {
  dayCount: 7 | 14;
  running: boolean;
  reduced: boolean;
}) {
  // Navigateur seulement (`ssr: false`) : la date du jour est celle du visiteur.
  const [{ grid, free, still }] = useState(() => {
    const grid = buildSlotGrid(
      todayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone),
      GRID_SEED,
      dayCount,
    );
    const free = frontFreeCells(grid);
    // Mouvement réduit : quelques créneaux libres allumés, toujours les mêmes.
    return { grid, free, still: new Set(free.filter((_, index) => index % 9 === 2)) };
  });
  // Créneau allumé → instant où il s'éteint.
  const [lit, setLit] = useState<ReadonlyMap<string, number>>(new Map());

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setLit((current) => {
        const now = Date.now();
        const next = new Map([...current].filter(([, until]) => until > now));
        const candidates = free.filter((cell) => !next.has(cell));
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        if (chosen) next.set(chosen, now + LIGHT_FOR_MS);
        return next;
      });
    }, LIGHT_EVERY_MS);
    return () => clearInterval(timer);
  }, [running, free]);

  const isLit = (cell: string) => (reduced ? still.has(cell) : lit.has(cell));

  return (
    <div className={styles.grid}>
      <div className={cn(styles.plane, dayCount === 7 && styles.planeWeek)}>
        <span />
        {grid.days.map((day) => (
          <span key={day.date} className={styles.day}>
            {day.label}
          </span>
        ))}
        {grid.rows.map((row, rowIndex) => [
          <span key={row.hour} className={styles.hour}>
            {row.label}
          </span>,
          ...row.cells.map((cell, day) => (
            <span
              key={key(rowIndex, day)}
              className={cn(
                styles.slot,
                cell.taken && styles.taken,
                isLit(key(rowIndex, day)) && styles.lit,
              )}
            >
              {cell.time}
            </span>
          )),
        ])}
      </div>
    </div>
  );
}
