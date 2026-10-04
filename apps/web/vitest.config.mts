import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Même alias que `tsconfig.json` (`@/*` → racine de l'app).
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['**/*.test.ts'], exclude: ['node_modules/**', '.next/**'] },
});
