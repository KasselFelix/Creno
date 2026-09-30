import { CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchApiStatus } from './api-status';

function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>État de l&apos;API</CardTitle>
        <CardDescription>Vérifié à chaque chargement via /health/ready.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

export async function ApiStatusCard() {
  const status = await fetchApiStatus();

  if (status === 'up') {
    return (
      <StatusCard>
        <Badge>
          <CircleCheck aria-hidden className="size-4" />
          Opérationnelle
        </Badge>
      </StatusCard>
    );
  }

  return (
    <StatusCard>
      <Badge variant="destructive">
        <CircleAlert aria-hidden className="size-4" />
        Indisponible
      </Badge>
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>L&apos;API ne répond pas</AlertTitle>
        <AlertDescription>
          Vérifiez que la stack tourne avec <code>docker compose up</code>, puis rechargez la page.
        </AlertDescription>
      </Alert>
    </StatusCard>
  );
}

export function ApiStatusCardSkeleton() {
  return (
    <StatusCard>
      <div role="status" aria-busy="true">
        <Skeleton className="h-6 w-32" />
        <span className="sr-only">Vérification de l&apos;API…</span>
      </div>
    </StatusCard>
  );
}
