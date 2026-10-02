'use client';

import { useEffect, useState } from 'react';

/** Renvoie `value` une fois qu'elle n'a plus changé pendant `delayMs` (ex. fin de frappe). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
