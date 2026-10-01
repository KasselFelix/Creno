'use client';

import { CircleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useRevokeSession, useSessions } from '@/features/auth/api';
import { errorMessage } from '@/lib/api/errors';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

/** Nom lisible d'un appareil à partir du User-Agent (volontairement simple). */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Appareil inconnu';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Navigateur';
  const system = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return system ? `${browser} sur ${system}` : browser;
}

export function SessionsTable() {
  const sessions = useSessions();
  const revoke = useRevokeSession();

  if (sessions.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <span className="sr-only">Chargement des sessions…</span>
      </div>
    );
  }

  if (sessions.isError) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>Impossible de charger vos sessions</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          {errorMessage(sessions.error)}
          <Button variant="outline" onClick={() => sessions.refetch()}>
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  function handleRevoke(sessionId: string) {
    revoke.mutate(sessionId, {
      onSuccess: () => toast.success('Appareil déconnecté.'),
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Appareil</TableHead>
          <TableHead>Dernière activité</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.data.items.map((session) => (
          <TableRow key={session.id}>
            <TableCell className="font-medium">
              <span className="flex flex-wrap items-center gap-2">
                {describeDevice(session.userAgent)}
                {session.current && <Badge variant="secondary">Cet appareil</Badge>}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {dateFormat.format(new Date(session.lastUsedAt))}
            </TableCell>
            <TableCell className="text-right">
              {!session.current && (
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={revoke.isPending && revoke.variables === session.id}
                  onClick={() => handleRevoke(session.id)}
                >
                  Déconnecter
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
