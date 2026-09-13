import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthUser } from '@/stores/auth';
import { useEraseUser, useExportUserData, useUsers } from '@/hooks/useUsers';
import { isSchoolAdmin, roleLabel } from '@/lib/utils';
import { ErrorState } from '@/components/error-state';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';

import type { ErasureReport, UserExport } from '@/types/models';
import type { UserStatus } from '@/types/api';

const statusTone: Record<UserStatus, 'secondary' | 'success' | 'warning'> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  SUSPENDED: 'warning',
};

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function UserDetailPage() {
  const { id } = useParams<'id'>();
  const currentUser = useAuthUser();
  const navigate = useNavigate();
  const isAdmin = isSchoolAdmin(currentUser?.role ?? 'STUDENT');

  const { data: users = [], isLoading, error, refetch } = useUsers();
  const exportUser = useExportUserData();
  const eraseUser = useEraseUser(id ?? '');

  const [exportResult, setExportResult] = useState<UserExport | null>(null);
  const [eraseReport, setEraseReport] = useState<ErasureReport | null>(null);
  const [revokeCertificates, setRevokeCertificates] = useState(true);

  const user = users.find((u) => u.id === id);

  async function handleExport() {
    if (!user) return;
    try {
      const result = await exportUser.mutateAsync(user.id);
      setExportResult(result);
      toast.success('Export ready');
    } catch {
      /* global mutation toast covers the failure */
    }
  }

  async function handleErase() {
    if (!user) return;
    try {
      // The backend refuses an erasure until the certificate decision is made
      // explicitly (409 otherwise) — relay the checkbox choice verbatim.
      const report = await eraseUser.mutateAsync({ revokeCertificates });
      setEraseReport(report);
      toast.success('User data erased');
    } catch {
      /* global mutation toast covers the failure */
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<Skeleton className="h-7 w-44" />}
          description={<Skeleton className="mt-1 h-4 w-64" />}
        >
          <Skeleton className="h-9 w-24" />
        </PageHeader>
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <ErrorState
          title="Couldn't load this user"
          description="Something went wrong while fetching the user's details."
          onRetry={refetch}
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">User not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This user may have been removed, or you don't have access to them.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/users')}>
          Back to users
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AlertDialog>
        <PageHeader title={user.name} description={user.email}>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{roleLabel(user.role)}</Badge>
            {user.erasedAt ? (
              <Badge variant="outline">Erased</Badge>
            ) : (
              <Badge variant={statusTone[user.status]}>{user.status}</Badge>
            )}
            {isAdmin ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExport}
                  disabled={exportUser.isPending}
                >
                  <Download className="mr-1" aria-hidden /> Export data
                </Button>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive">
                    <Trash2 className="mr-1" aria-hidden /> Erase data
                  </Button>
                </AlertDialogTrigger>
              </>
            ) : null}
          </div>
        </PageHeader>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase {user.name}'s data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently anonymises this user's personal data — profile fields, activity,
              stored files and certificates — and cannot be undone.
            </AlertDialogDescription>
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={revokeCertificates}
                onCheckedChange={(v) => setRevokeCertificates(v === true)}
                aria-label="Revoke this user's certificates"
              />
              <span className="space-y-0.5">
                <span className="font-medium">Revoke this user's certificates</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Their certificates will become invalid and no longer verifiable by serial.
                </span>
              </span>
            </label>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleErase}
              disabled={eraseUser.isPending}
            >
              {eraseUser.isPending ? 'Erasing…' : 'Erase data'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-lg">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-lg font-semibold">{user.name}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <dl className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Role</dt>
              <dd className="mt-0.5 text-sm">{roleLabel(user.role)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Status</dt>
              <dd className="mt-0.5 text-sm">{user.erasedAt ? 'Erased' : user.status}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Last login</dt>
              <dd className="mt-0.5 text-sm text-muted-foreground">
                {user.lastLoginAt ? format(new Date(user.lastLoginAt), 'PP p') : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Created</dt>
              <dd className="mt-0.5 text-sm text-muted-foreground">
                {format(new Date(user.createdAt), 'PP p')}
              </dd>
            </div>
            {user.erasedAt ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Erased at</dt>
                <dd className="mt-0.5 text-sm text-muted-foreground">
                  {format(new Date(user.erasedAt), 'PP p')}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Dialog
        open={exportResult !== null}
        onOpenChange={(open) => {
          if (!open) setExportResult(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export summary</DialogTitle>
            <DialogDescription>
              {exportResult
                ? `Exported ${format(new Date(exportResult.exportedAt), 'PP p')}. Shown as a report — this page has no file download.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {exportResult ? (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Subject:{' '}
                <a
                  href={`mailto:${exportResult.subject.email}`}
                  className="font-medium text-primary hover:underline"
                >
                  {exportResult.subject.email}
                </a>
              </p>
              <div className="divide-y overflow-hidden rounded-md border">
                {[
                  { label: 'Enrollments', value: exportResult.counts.enrollments },
                  { label: 'Quiz attempts', value: exportResult.counts.quizAttempts },
                  {
                    label: 'Assignment submissions',
                    value: exportResult.counts.assignmentSubmissions,
                  },
                  { label: 'Certificates', value: exportResult.counts.certificates },
                  { label: 'Video progress', value: exportResult.counts.videoProgress },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 px-3 py-2">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={eraseReport !== null}
        onOpenChange={(open) => {
          if (!open) setEraseReport(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erasure report</DialogTitle>
            <DialogDescription>
              {eraseReport
                ? `Completed ${format(new Date(eraseReport.erasedAt), 'PP p')}. The user's identity has been anonymised.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {eraseReport ? (
            <div className="space-y-4 text-sm">
              <div>
                <p className="mb-1 font-medium">Overwritten fields</p>
                <p className="text-muted-foreground">
                  {eraseReport.overwritten.length > 0
                    ? eraseReport.overwritten.join(', ')
                    : 'None'}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Certificates revoked</p>
                  <p className="mt-0.5 text-lg font-semibold">{eraseReport.certificates.revoked}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Certificates untouched</p>
                  <p className="mt-0.5 text-lg font-semibold">
                    {eraseReport.certificates.untouched}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Storage deleted</p>
                  <p className="mt-0.5 text-lg font-semibold">{eraseReport.storage.deleted}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Storage failed</p>
                  <p className="mt-0.5 text-lg font-semibold">{eraseReport.storage.failed}</p>
                </div>
              </div>
              {eraseReport.note ? (
                <p className="text-xs text-muted-foreground">{eraseReport.note}</p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}