import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = { title: 'Confidentialité — Creno' };

const PROCESSORS: { name: string; role: string }[] = [
  { name: 'Vercel', role: 'hébergement du site (fonctions serveur à Paris).' },
  {
    name: 'Microsoft Azure (France Central)',
    role: 'hébergement de l’API et de la base de données, journaux techniques.',
  },
  {
    name: 'Stripe',
    role: 'paiement. Creno ne voit jamais votre carte : la saisie se fait chez Stripe.',
  },
  { name: 'Resend', role: 'envoi des emails (lien d’inscription, confirmations, rappels).' },
  { name: 'Twilio', role: 'envoi des SMS (code de vérification, rappel), si activés.' },
  {
    name: 'Mistral AI (Union européenne)',
    role: 'reçoit la phrase tapée dans la recherche en langage naturel, pour la traduire en filtres.',
  },
  {
    name: 'Mapbox',
    role: 'affiche la carte : reçoit la zone affichée et des données techniques de navigation.',
  },
  {
    name: 'Sentry (région Union européenne)',
    role: 'suivi des erreurs, sans cookie, sans adresse IP, sans position ni adresse recherchée.',
  },
];

const RETENTION: { data: string; duration: string }[] = [
  {
    data: 'Compte (nom, email, téléphone vérifié) et réservations',
    duration: 'tant que le compte existe',
  },
  { data: 'Sessions de connexion', duration: 'jusqu’à leur expiration (30 jours au plus)' },
  {
    data: 'Recherches en langage naturel (longueur de la phrase et filtres, jamais la phrase ni le lieu)',
    duration: '90 jours',
  },
  { data: 'Événements de paiement reçus de Stripe', duration: '90 jours' },
  { data: 'Journaux techniques (sans email ni adresse IP)', duration: '30 jours' },
];

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Confidentialité</h1>
          <p className="text-muted-foreground">
            Creno est un projet de démonstration. Voici les données qu’il traite, qui les reçoit et
            combien de temps elles sont gardées.
          </p>
        </div>

        <section className="flex flex-col gap-3" aria-labelledby="donnees">
          <h2 id="donnees" className="text-xl font-semibold tracking-tight">
            Données collectées
          </h2>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5">
            <li>Votre compte : nom, email, mot de passe (stocké haché, jamais en clair).</li>
            <li>Votre téléphone, seulement si vous l’ajoutez et le vérifiez par SMS.</li>
            <li>Vos réservations et leurs paiements (montant, statut ; pas votre carte).</li>
            <li>
              Pour un prestataire : son nom, son adresse et ses horaires, affichés publiquement.
            </li>
          </ul>
          <p className="text-muted-foreground">
            Seuls des cookies de session sont utilisés (connexion), sans aucun traceur publicitaire.
          </p>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="sous-traitants">
          <h2 id="sous-traitants" className="text-xl font-semibold tracking-tight">
            Services qui reçoivent des données
          </h2>
          <ul className="space-y-2">
            {PROCESSORS.map((processor) => (
              <li key={processor.name}>
                <span className="font-medium">{processor.name}</span>
                <span className="text-muted-foreground"> : {processor.role}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="conservation">
          <h2 id="conservation" className="text-xl font-semibold tracking-tight">
            Durées de conservation
          </h2>
          <ul className="space-y-2">
            {RETENTION.map((item) => (
              <li key={item.data}>
                <span>{item.data}</span>
                <span className="text-muted-foreground"> : {item.duration}.</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="droits">
          <h2 id="droits" className="text-xl font-semibold tracking-tight">
            Vos droits
          </h2>
          <p className="text-muted-foreground">
            Vous pouvez demander l’accès, la rectification ou la suppression de vos données en
            contactant l’auteur du projet via{' '}
            <a
              href="https://github.com/KasselFelix/Creno"
              className="hover:text-foreground underline underline-offset-4"
              rel="noopener"
            >
              son dépôt GitHub
            </a>
            .
          </p>
        </section>
      </main>
    </>
  );
}
