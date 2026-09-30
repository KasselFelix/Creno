// Configuration ESLint partagée (flat config) : TypeScript strict, pas de `any`, pas de console.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const base = tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/migrations/**', '**/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
);

export default base;
