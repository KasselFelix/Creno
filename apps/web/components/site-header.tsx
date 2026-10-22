import { Search } from 'lucide-react';
import Link from 'next/link';
import { CrenoLogo } from '@/components/creno-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { buttonVariants } from '@/components/ui/button';
import { UserMenu } from '@/features/auth/components/user-menu';
import { getCurrentUser } from '@/lib/api/server';

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <Link
          href="/"
          className="inline-flex h-11 min-w-11 items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <CrenoLogo className="size-6 shrink-0" />
          {/* Sous 640 px, le logo seul : le nom ferait déborder l'en-tête à 375 px. */}
          <span className="max-sm:sr-only">Creno</span>
        </Link>
        <nav aria-label="Principale" className="mr-auto">
          <Link
            href="/search"
            className={buttonVariants({
              variant: 'ghost',
              className: 'h-11 min-w-11 px-2 sm:px-2.5 md:h-9',
            })}
          >
            <Search aria-hidden className="size-5" />
            <span className="sr-only sm:not-sr-only">Rechercher</span>
          </Link>
        </nav>
        <nav aria-label="Compte" className="flex min-w-0 items-center gap-1 sm:gap-2">
          {user ? (
            <UserMenu user={user} />
          ) : (
            <>
              {/* Libellés courts sous 640px : les deux actions tiennent sans débordement à 375px. */}
              <Link
                href="/login"
                className={buttonVariants({
                  variant: 'ghost',
                  className: 'h-11 px-2 sm:px-2.5 md:h-9',
                })}
              >
                <span className="sm:hidden">Connexion</span>
                <span className="hidden sm:inline">Se connecter</span>
              </Link>
              <Link
                href="/register"
                className={buttonVariants({ className: 'h-11 px-2 sm:px-2.5 md:h-9' })}
              >
                <span className="sm:hidden">S&apos;inscrire</span>
                <span className="hidden sm:inline">Créer un compte</span>
              </Link>
            </>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
