import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useEnquiries, useUpdateEnquiryStatus } from '@/hooks/useEnquiries';
import type { EnquiryStatus } from '@/api/enquiries';

const statuses: Array<{ value: EnquiryStatus; label: string }> = [
  { value: 'NEW', label: 'New' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'CLOSED', label: 'Closed' },
];

export function AdminEnquiriesPage() {
  const enquiries = useEnquiries();
  const updateStatus = useUpdateEnquiryStatus();

  return (
    <div className="space-y-6">
      <PageHeader title="Public enquiries" description="Review contact and demo requests submitted through the public website." />
      {enquiries.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading enquiries…</p> : null}
      {enquiries.isError ? (
        <Card><CardContent className="flex items-center justify-between gap-4 py-6"><p role="alert">Enquiries could not be loaded.</p><button type="button" className="text-sm font-medium text-primary underline" onClick={() => void enquiries.refetch()}>Try again</button></CardContent></Card>
      ) : null}
      {!enquiries.isPending && !enquiries.isError && enquiries.data?.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">There are no enquiries yet.</CardContent></Card>
      ) : null}
      <div className="space-y-4">
        {enquiries.data?.map((enquiry) => (
          <Card key={enquiry.id}>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{enquiry.name}</CardTitle>
                  <Badge variant={enquiry.kind === 'DEMO' ? 'default' : 'secondary'}>{enquiry.kind === 'DEMO' ? 'Demo request' : 'General enquiry'}</Badge>
                </div>
                <CardDescription>
                  <a className="underline" href={`mailto:${enquiry.email}`}>{enquiry.email}</a>
                  {enquiry.phone ? <> · <a className="underline" href={`tel:${enquiry.phone}`}>{enquiry.phone}</a></> : null}
                  {enquiry.organisation ? <> · {enquiry.organisation}</> : null}
                </CardDescription>
                <p className="text-xs text-muted-foreground">Received {new Date(enquiry.submittedAt).toLocaleString()}</p>
              </div>
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Status
                <select
                  className="h-9 min-w-36 rounded-md border bg-background px-2 text-sm text-foreground"
                  value={enquiry.status}
                  aria-label={`Update status for enquiry from ${enquiry.name}`}
                  disabled={updateStatus.isPending}
                  onChange={(event) => {
                    updateStatus.mutate(
                      { id: enquiry.id, status: event.target.value as EnquiryStatus },
                      { onError: () => toast.error('The enquiry status could not be updated.') },
                    );
                  }}
                >
                  {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
              </label>
            </CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm leading-6">{enquiry.message}</p></CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
