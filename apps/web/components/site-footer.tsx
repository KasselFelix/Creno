import Link from 'next/link';

/** Pied de page commun : confidentialité et code source. */
export function SiteFooter() {
  return (
    <footer className="text-muted-foreground mt-auto border-t text-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <span>Creno — projet portfolio</span>
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
    </footer>
  );
}
