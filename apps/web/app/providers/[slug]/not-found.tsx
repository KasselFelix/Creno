import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { buttonVariants } from '@/components/ui/button';

export default function ProviderNotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-4 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Prestataire introuvable</h1>
        <p className="text-muted-foreground">
          Cette fiche n&apos;existe pas ou n&apos;existe plus.
        </p>
        <Link href="/" className={buttonVariants({ variant: 'outline', className: 'h-11' })}>
          Retour à l&apos;accueil
        </Link>
      </main>
    </>
  );
}
