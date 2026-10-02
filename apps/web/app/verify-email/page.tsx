import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { VerifyEmailCard } from '@/features/auth/components/verify-email-card';

export const metadata: Metadata = {
  title: 'Confirmer mon adresse — Creno',
  robots: { index: false },
  // Le jeton est dans le fragment, qui ne part jamais dans un Referer ; ceci couvre le reste de l'URL.
  referrer: 'no-referrer',
};

/**
 * Arrivée depuis le lien de l'email d'inscription. Page publique : le lien s'ouvre souvent sur un
 * autre appareil, et la confirmation ne demande que le jeton. Un clic est demandé (pas de
 * confirmation au chargement) : un antivirus de messagerie qui précharge les liens ne doit pas
 * consommer le jeton à la place de la personne.
 */
export default function VerifyEmailPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <VerifyEmailCard />
      </main>
    </>
  );
}
