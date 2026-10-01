import { randomBytes } from 'node:crypto';

// `me` est une route (`GET /providers/me`) : ce slug ne doit jamais désigner une fiche.
const RESERVED = new Set(['me']);

/** `Studio Lumière` → `studio-lumiere`. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug && !RESERVED.has(slug) ? slug : withSuffix(slug || 'prestataire');
}

/** Slug rendu unique par un suffixe aléatoire court. */
export function withSuffix(slug: string): string {
  return `${slug}-${randomBytes(3).toString('hex')}`;
}
