import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { DemoBanner } from '@/components/demo-banner';
import { Providers } from '@/components/providers';
import { SiteFooter } from '@/components/site-footer';
import './globals.css';

const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Creno',
  description: 'Réservez salles, coiffeurs, terrains et photographes près de chez vous.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Nonce de la CSP, posé par proxy.ts. Lire les en-têtes rend toutes les pages dynamiques : c'est
  // voulu, une page pré-rendue au build n'aurait pas de nonce et ses scripts seraient bloqués.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <Providers nonce={nonce}>
          <DemoBanner />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
