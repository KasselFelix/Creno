import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// En local, les variables viennent du .env racine ; en CI, de l'environnement du job.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
