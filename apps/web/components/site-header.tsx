import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { buttonVariants } from '@/components/ui/button';
import { UserMenu } from '@/features/auth/components/user-menu';
import { getCurrentUser } from '@/lib/api/server';

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Creno
        </Link>
        <nav aria-label="Compte" className="flex items-center gap-2">
          {user ? (
            <UserMenu user={user} />
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ variant: 'ghost' })}>
                Se connecter
              </Link>
              <Link href="/register" className={buttonVariants()}>
                Créer un compte
              </Link>
            </>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
