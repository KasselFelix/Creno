'use client';

import { CalendarDays, LayoutDashboard, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';

const links = [
  { href: '/dashboard', label: 'Aperçu', Icon: LayoutDashboard },
  { href: '/dashboard/calendar', label: 'Calendrier', Icon: CalendarDays },
  { href: '/dashboard/bookings', label: 'Réservations', Icon: ListChecks },
] as const;

/** Navigation de l'espace prestataire : en colonne sur desktop, en ligne au-dessus du contenu sur mobile. */
export function DashboardNav() {
  const pathname = usePathname();
  // Les pages de ressources (`/dashboard/resources/…`) relèvent de l'aperçu, où elles sont listées.
  const current =
    links.find((link) => link.href !== '/dashboard' && pathname.startsWith(link.href))?.href ??
    '/dashboard';

  return (
    <nav aria-label="Espace prestataire" className="md:w-48 md:shrink-0">
      <ul className="grid grid-cols-3 gap-1 md:sticky md:top-6 md:flex md:flex-col">
        {links.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={href === current ? 'page' : undefined}
              className={buttonVariants({
                variant: href === current ? 'secondary' : 'ghost',
                className: 'h-11 w-full justify-center px-2 md:justify-start md:px-2.5',
              })}
            >
              {/* Sous 640 px, les trois libellés tiennent sur une ligne sans leurs icônes. */}
              <Icon aria-hidden className="hidden size-5 sm:block" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
