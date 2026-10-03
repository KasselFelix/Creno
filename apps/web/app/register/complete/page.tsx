import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { CompleteRegistrationCard } from '@/features/auth/components/complete-registration-card';

export const metadata: Metadata = {
  title: 'Terminer mon inscription — Creno',
  robots: { index: false },
  // Le jeton est dans le fragment, qui ne part jamais dans un Referer ; ceci couvre le reste de l'URL.
  referrer: 'no-referrer',
};

/**
 * Arrivée depuis le lien de l'email d'inscription. Page publique : le lien s'ouvre souvent sur un
 * autre appareil, et le jeton suffit. Le compte n'est créé qu'à l'envoi du formulaire : un
 * antivirus de messagerie qui précharge les liens ne peut pas consommer le jeton.
 */
export default function CompleteRegistrationPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12">
        <CompleteRegistrationCard />
      </main>
    </>
  );
}
