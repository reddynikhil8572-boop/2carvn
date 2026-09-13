import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { CheckCircle2, Search, ShieldAlert, ShieldCheck } from 'lucide-react';

import { useVerifyCertificate } from '@/hooks/useCertificate';
import { certificateDownloadUrl } from '@/api/certificates';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Public (or lightly auth-gated) certificate verification page. Shows the
 * serial-based result: valid / revoked / not found.
 */
export function CertificateVerifyPage() {
  const params = useParams<'serial'>();
  const [serial, setSerial] = useState(params.serial ?? '');
  const [submittedSerial, setSubmittedSerial] = useState(params.serial ?? '');

  const { data: cert, isLoading, error } = useVerifyCertificate(submittedSerial);

  useEffect(() => {
    if (params.serial) {
      setSerial(params.serial);
      setSubmittedSerial(params.serial);
    }
  }, [params.serial]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = serial.trim();
    if (!trimmed) return;
    setSubmittedSerial(trimmed);
  }

  const revoked = cert?.revokedAt != null;
  const invalid = error || (!cert && !isLoading);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verify a certificate"
        description="Enter a serial number to check whether the certificate is genuine and hasn't been revoked."
      >
        <Button asChild variant="ghost" size="sm">
          <Link to="/certificates">Back to certificates</Link>
        </Button>
      </PageHeader>

      <form onSubmit={handleSubmit} className="flex max-w-lg gap-2">
        <div className="flex-1 space-y-2">
          <Label htmlFor="serial" className="sr-only">Serial number</Label>
          <Input
            id="serial"
            placeholder="Paste serial number"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!serial.trim()}>
          <Search className="mr-1" aria-hidden /> Verify
        </Button>
      </form>

      {/* Result card */}
      {isLoading ? (
        <Skeleton className="h-48 w-full max-w-lg rounded-lg" />
      ) : cert ? (
        <Card className="max-w-lg">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            {revoked ? (
              <ShieldAlert className="h-5 w-5 text-warning" aria-hidden />
            ) : (
              <ShieldCheck className="h-5 w-5 text-success" aria-hidden />
            )}
            <CardTitle className="text-base">
              {revoked ? 'Certificate revoked' : 'Certificate valid'}
            </CardTitle>
            <Badge variant={revoked ? 'warning' : 'success'} className="ml-auto">
              {revoked ? 'Revoked' : 'Valid'}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Student</dt>
              <dd className="font-medium">{cert.studentName}</dd>

              <dt className="text-muted-foreground">Course</dt>
              <dd className="font-medium">{cert.courseTitle}</dd>

              <dt className="text-muted-foreground">School</dt>
              <dd className="font-medium">{cert.schoolName}</dd>

              <dt className="text-muted-foreground">Issued</dt>
              <dd className="font-medium">{format(new Date(cert.issuedAt), 'MMM d, yyyy')}</dd>

              <dt className="text-muted-foreground">Serial</dt>
              <dd className="font-mono text-xs text-muted-foreground">{cert.serial}</dd>
            </dl>
            {cert.revokeReason ? (
              <>
                <Separator />
                <p className="text-sm text-destructive">Revoke reason: {cert.revokeReason}</p>
              </>
            ) : null}
            {!revoked ? (
              <Button asChild variant="outline" size="sm" className="w-max">
                <a href={certificateDownloadUrl(cert.serial)} target="_blank" rel="noreferrer">
                  <CheckCircle2 className="mr-1" aria-hidden /> Download PDF
                </a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : invalid ? (
        <Card className="max-w-lg">
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium">No certificate found for this serial.</p>
            <p className="mt-1 text-xs text-muted-foreground">Check the serial and try again.</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}