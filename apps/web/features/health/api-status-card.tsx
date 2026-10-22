import { CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchApiStatus } from './api-status';
import { DismissibleStatusCard } from './dismissible-status-card';

function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pr-12">
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
      <DismissibleStatusCard status={status}>
        <StatusCard>
          <Badge>
            <CircleCheck aria-hidden className="size-4" />
            Opérationnelle
          </Badge>
        </StatusCard>
      </DismissibleStatusCard>
    );
  }

  return (
    <DismissibleStatusCard status={status}>
      <StatusCard>
        <Badge variant="destructive">
          <CircleAlert aria-hidden className="size-4" />
          Indisponible
        </Badge>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>L&apos;API ne répond pas</AlertTitle>
          <AlertDescription>
            Vérifiez que la stack tourne avec <code>docker compose up</code>, puis rechargez la
            page.
          </AlertDescription>
        </Alert>
      </StatusCard>
    </DismissibleStatusCard>
  );
}
