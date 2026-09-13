import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

import { useSession } from '@/hooks/useAuth';
import { useAuthUser } from '@/stores/auth';
import { roleLabel } from '@/lib/utils';
import type { MeResponse } from '@/types/models';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function SettingsPage() {
  const authUser = useAuthUser();
  const { user: sessionUser } = useSession();

  const user = authUser ?? sessionUser;
  const school = (
    sessionUser && 'school' in sessionUser ? sessionUser.school : undefined
  ) as MeResponse['school'] | undefined;

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your account, school and security." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-12 w-12">
                {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.name} /> : null}
                <AvatarFallback>{initialsFor(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold leading-tight">{user.name}</p>
                <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <Badge variant="secondary">{roleLabel(user.role)}</Badge>
            <p className="text-sm text-muted-foreground">
              Name and email changes are managed by your school administrator.
            </p>
          </CardContent>
        </Card>

        {school ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">School</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                {school.logoUrl ? (
                  <img
                    src={school.logoUrl}
                    alt={`${school.name} logo`}
                    className="h-10 w-10 rounded-md border border-border object-contain"
                  />
                ) : null}
                <p className="font-semibold">{school.name}</p>
              </div>
              <div className="flex items-center gap-3">
                <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
                  {school.schoolCode}
                </code>
                {school.primaryColor ? (
                  <span
                    className="inline-block h-4 w-4 rounded-full border border-border"
                    style={{ backgroundColor: school.primaryColor ?? 'transparent' }}
                    aria-hidden
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              <CardTitle className="text-base">Security</CardTitle>
            </div>
            <CardDescription>
              Protect your account with two-factor authentication and recovery codes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/settings/security">Manage security & 2FA</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}