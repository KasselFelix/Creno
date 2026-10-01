'use client';

import { LayoutDashboard, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { PublicUser } from '@creno/shared';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { errorMessage } from '@/lib/api/errors';
import { useLogout } from '../api';

function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function UserMenu({ user }: { user: PublicUser }) {
  const router = useRouter();
  const logout = useLogout();

  function handleLogout() {
    logout.mutate(undefined, {
      onSuccess: () => {
        router.push('/');
        router.refresh();
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-11 gap-2 px-2"
            aria-label={`Menu du compte de ${user.fullName}`}
          />
        }
      >
        <Avatar className="size-8">
          <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
        </Avatar>
        <span className="hidden text-sm font-medium sm:inline">{user.fullName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 sm:min-h-8" render={<Link href="/account" />}>
          <UserRound aria-hidden className="size-4" />
          Mon compte
        </DropdownMenuItem>
        {user.role === 'provider' && (
          <DropdownMenuItem className="min-h-11 sm:min-h-8" render={<Link href="/dashboard" />}>
            <LayoutDashboard aria-hidden className="size-4" />
            Espace prestataire
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="min-h-11 sm:min-h-8"
          onClick={handleLogout}
          disabled={logout.isPending}
        >
          <LogOut aria-hidden className="size-4" />
          Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
