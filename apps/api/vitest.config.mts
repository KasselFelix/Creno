import { existsSync } from 'node:fs';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// En local, les variables viennent du .env racine ; en CI, de l'environnement du job.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  // SWC émet les métadonnées de décorateurs dont l'injection de dépendances de Nest a besoin.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globalSetup: ['test/global-setup.ts'],
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
