import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PhoneCard } from '@/features/account/components/phone-card';
import { ProfileForm } from '@/features/account/components/profile-form';
import { SessionsTable } from '@/features/account/components/sessions-table';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Mon compte — Creno' };

const roleLabels = {
  customer: 'Client',
  provider: 'Prestataire',
  admin: 'Administrateur',
} as const;

export default async function AccountPage() {
  const user = await getCurrentUser();
  // proxy.ts redirige déjà ; ce contrôle reste la référence si le proxy est contourné ou mal configuré.
  if (!user) redirect('/login?next=/account');

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Mon compte</h1>
          <Badge variant="secondary">{roleLabels[user.role]}</Badge>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Profil</h2>
            </CardTitle>
            <CardDescription>Ces informations servent à vos réservations.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm user={user} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Téléphone</h2>
            </CardTitle>
            <CardDescription>
              Pour recevoir le rappel de vos réservations par SMS, la veille.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* key : après une vérification ou un retrait, la carte repart de l'état affiché. */}
            <PhoneCard key={user.phone ?? 'none'} phone={user.phone} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Appareils connectés</h2>
            </CardTitle>
            <CardDescription>
              Déconnectez un appareil que vous ne reconnaissez pas ou que vous n&apos;utilisez plus.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SessionsTable />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
