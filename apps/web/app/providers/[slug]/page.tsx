import { MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { publicProviderSchema } from '@creno/shared';
import { SiteHeader } from '@/components/site-header';
import { Badge } from '@/components/ui/badge';
import { SlotPicker } from '@/features/availability/components/slot-picker';
import { categoryLabels } from '@/features/providers/labels';
import { serverFetch } from '@/lib/api/server';

type Props = { params: Promise<{ slug: string }> };

// `cache` : la page et ses métadonnées partagent le même appel à l'API.
const getProvider = cache((slug: string) =>
  serverFetch(`/v1/providers/${encodeURIComponent(slug)}`, publicProviderSchema),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const provider = await getProvider((await params).slug);
  return { title: provider ? `${provider.name} — Creno` : 'Prestataire introuvable — Creno' };
}

export default async function ProviderPage({ params }: Props) {
  const provider = await getProvider((await params).slug);
  if (!provider) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10">
        <header className="flex flex-col gap-3">
          <Badge variant="secondary">{categoryLabels[provider.category]}</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">{provider.name}</h1>
          <p className="text-muted-foreground flex items-center gap-2">
            <MapPin aria-hidden className="size-4 shrink-0" />
            {provider.address}, {provider.city}
          </p>
          {provider.description && (
            <p className="max-w-2xl whitespace-pre-line">{provider.description}</p>
          )}
        </header>
        {provider.resources.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center">
            Ce prestataire ne propose pas encore de réservation en ligne.
          </p>
        ) : (
          <SlotPicker resources={provider.resources} />
        )}
      </main>
    </>
  );
}
