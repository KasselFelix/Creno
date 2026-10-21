import { Camera, DoorOpen, type LucideIcon, Scissors, Store, Trophy } from 'lucide-react';
import type { ProviderCategory } from '@creno/shared';

/** Icône de chaque catégorie : pastilles de la carte et badges de la liste. */
export const categoryIcons: Record<ProviderCategory, LucideIcon> = {
  room: DoorOpen,
  hairdresser: Scissors,
  sports_field: Trophy,
  photographer: Camera,
  other: Store,
};
