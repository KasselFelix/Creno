'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/** `nonce` : le script inline de next-themes (thème appliqué avant l'affichage) passe la CSP. */
export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      nonce={nonce}
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
