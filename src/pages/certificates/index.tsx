import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Award, FileDown, ShieldX } from 'lucide-react';

import { useCourses } from '@/hooks/useCourses';
import { useCertificates, useIssueCertificate, useRevokeCertificate } from '@/hooks/useCertificate';
import { useAuthUser } from '@/stores/auth';
import { isStaff } from '@/lib/utils';
import { certificateDownloadUrl } from '@/api/certificates';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import type { Certificate } from '@/types/models';

/**
 * Certificates are stored per course (GET /courses/:id/certificates), so this
 * page is course-scoped: pick a course to manage/see its certificates.
 */
export function CertificatesPage() {
  const user = useAuthUser();
  const staff = user ? isStaff(user.role) : false;
  const {
    data: courses = [],
    isLoading: coursesLoading,
    error: coursesError,
    refetch: refetchCourses,
  } = useCourses();

  const [courseId, setCourseId] = useState<string>('');
  const enabledCourseId = courseId || courses[0]?.id || '';

  const {
    data: certificates = [],
    isLoading: certsLoading,
    error: certsError,
    refetch: refetchCerts,
  } = useCertificates(enabledCourseId);
  const issue = useIssueCertificate(enabledCourseId);
  const revoke = useRevokeCertificate(enabledCourseId);

  const [issuingFor, setIssuingFor] = useState<string>('');

  async function handleIssue() {
    if (!issuingFor || !enabledCourseId) return;
    try {
      await issue.mutateAsync(issuingFor);
      toast.success('Certificate issued.');
      setIssuingFor('');
    } catch { /* toast covers */ }
  }

  async function handleRevoke(cert: Certificate) {
    try {
      await revoke.mutateAsync({ serial: cert.serial, reason: 'Revoked by administrator' });
      toast.success(`Certificate ${cert.serial.slice(0, 8)}… revoked.`);
    } catch { /* toast covers */ }
  }

  const selectedCourse = courses.find((c) => c.id === enabledCourseId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificates"
        description={
          staff
            ? 'Issue and revoke certificates for a course.'
            : 'Your certificates, per course.'
        }
      />

      {/* Course picker */}
      <Card>
        <CardContent className="p-4">
          {coursesLoading ? (
            <Skeleton className="h-10 w-64" />
          ) : coursesError ? (
            <ErrorState
              title="Couldn't load courses"
              description="Selecting a course is needed to manage certificates."
              onRetry={refetchCourses}
            />
          ) : (
            <Select value={enabledCourseId} onValueChange={(v) => { setCourseId(v); setIssuingFor(''); }}>
              <SelectTrigger className="w-full max-w-md" aria-label="Course">
                <SelectValue placeholder="Select a course" />
              </SelectTrigger>
              <SelectContent>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {certsLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : certsError ? (
        <ErrorState onRetry={refetchCerts} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-4 w-4 text-primary" aria-hidden />
              {selectedCourse ? selectedCourse.title : 'Certificates'}
              <Badge variant="secondary">{certificates.length}</Badge>
            </CardTitle>
          </CardHeader>
          {certificates.length === 0 ? (
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No certificates issued for this course yet.
            </CardContent>
          ) : (
            <ScrollArea className="h-[24rem]">
              <CardContent className="space-y-2 p-4">
                {certificates.map((cert) => (
                  <div key={cert.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{cert.studentName}</p>
                      <p className="text-xs text-muted-foreground">
                        Issued {format(new Date(cert.issuedAt), 'MMM d, yyyy')} ·{' '}
                        <span className="font-mono text-[11px]">{cert.serial}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={cert.revokedAt ? 'warning' : 'success'}>
                        {cert.revokedAt ? 'Revoked' : 'Valid'}
                      </Badge>
                      {!cert.revokedAt ? (
                        <>
                          <Button asChild variant="outline" size="sm">
                            <a href={certificateDownloadUrl(cert.serial)} target="_blank" rel="noreferrer">
                              <FileDown className="mr-1" aria-hidden /> Download
                            </a>
                          </Button>
                          {staff ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" aria-label={`Revoke ${cert.studentName}`}>
                                  <ShieldX className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Revoke certificate?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This permanently invalidates the certificate for {cert.studentName}. Anyone
                                    scanning its code will see it as revoked.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleRevoke(cert)}>Revoke</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </ScrollArea>
          )}
        </Card>
      )}

      {staff ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Issue a certificate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Issue a certificate to a learner. Enter their user ID; the backend records today's date as issued.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                aria-label="Student user ID"
                className="h-10 w-full max-w-md rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="User ID"
                value={issuingFor}
                onChange={(e) => setIssuingFor(e.target.value)}
              />
              <Button onClick={handleIssue} disabled={!issuingFor || !enabledCourseId || issue.isPending}>
                {issue.isPending ? 'Issuing…' : 'Issue certificate'}
              </Button>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground">
              Verify any certificate publicly at{' '}
              <Link to="/certificates/verify" className="text-primary underline underline-offset-2">
                /certificates/verify
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}