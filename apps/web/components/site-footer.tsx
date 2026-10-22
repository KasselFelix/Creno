import Link from 'next/link';

/** Pied de page commun : confidentialité et code source. */
export function SiteFooter() {
  return (
    <footer className="text-muted-foreground mt-auto border-t text-sm">
      {/* Pleine largeur, comme l'en-tête : les liens aux extrémités de l'écran. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6 lg:px-8">
        <span>Creno — kassel.F</span>
        <div className="ml-auto flex flex-wrap items-center gap-x-4">
          <Link
            href="/confidentialite"
            className="hover:text-foreground inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Confidentialité
          </Link>
          <a
            href="https://github.com/KasselFelix/Creno"
            className="hover:text-foreground inline-flex min-h-11 items-center underline underline-offset-4"
            rel="noopener"
          >
            Code source
          </a>
        </div>
      </div>
    </footer>
  );
}
