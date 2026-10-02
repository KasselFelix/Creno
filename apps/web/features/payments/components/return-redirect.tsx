'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Rejoint la page de destination par une navigation qui part de notre site. */
export function ReturnRedirect({ to }: { to: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(to);
  }, [router, to]);

  return (
    <div role="status" className="flex flex-col items-center gap-3 text-center">
      <LoaderCircle aria-hidden className="text-muted-foreground size-8 animate-spin" />
      <p>Retour sur Creno…</p>
      <Link href={to} className="text-muted-foreground text-sm underline underline-offset-4">
        Continuer si rien ne se passe
      </Link>
    </div>
  );
}
