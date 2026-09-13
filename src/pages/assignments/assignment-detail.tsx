import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Clock, FileText, Send } from 'lucide-react';
import { toast } from 'sonner';

import { useAssignment, useSubmitAssignment } from '@/hooks/useAssignment';
import { useAuthUser } from '@/stores/auth';
import { isStaff } from '@/lib/utils';
import * as uploadsApi from '@/api/upload';
import { CenteredLoader } from '@/components/auth/route-guards';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { FilePicker } from '@/components/file-picker';

export function AssignmentDetailPage() {
  const { id } = useParams<'id'>();
  const itemId = id ?? '';
  const user = useAuthUser();
  const staff = user ? isStaff(user.role) : false;

  const { data: assignment, isLoading, error } = useAssignment(itemId);
  const submit = useSubmitAssignment(itemId);

  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  if (isLoading) return <CenteredLoader label="Loading assignment…" />;
  if (error || !assignment) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">Assignment not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">It may be unpublished or you don't have access.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/assignments">Back to assignments</Link>
        </Button>
      </div>
    );
  }

  async function handleSubmit() {
    if (!body.trim() && !file) {
      toast.error('Write something or attach a file before submitting.');
      return;
    }
    setUploading(true);
    try {
      let fileKey: string | undefined;
      if (file) {
        fileKey = await uploadsApi.uploadSubmissionFile(itemId, file, setUploadProgress);
      }
      await submit.mutateAsync({ bodyText: body.trim() || undefined, fileKey });
      setSubmitted(true);
      setBody('');
      setFile(null);
      setUploadProgress(0);
    } catch {
      /* toast covers */
    } finally {
      setUploading(false);
    }
  }

  const now = new Date();
  const dueAt = assignment.dueAt ? new Date(assignment.dueAt) : null;
  const overdue = dueAt ? now > dueAt : false;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/assignments"><ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Back</Link>
        </Button>
      </div>

      <PageHeader title={assignment.instructions ? 'Assignment' : assignment.instructions?.slice(0, 80) || 'Assignment'} description={null}>
        {dueAt ? (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className={`text-sm ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
              {overdue ? 'Overdue' : 'Due'} {format(dueAt, 'MMM d, yyyy · h:mm a')}
            </span>
          </div>
        ) : (
          <Badge variant="secondary">No due date</Badge>
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Instructions */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" aria-hidden /> Instructions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assignment.instructions ? (
              <p className="whitespace-pre-line text-sm text-muted-foreground">{assignment.instructions}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No instructions provided — write your answer below.</p>
            )}
            <Separator className="my-4" />
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>Max points: <span className="font-semibold text-foreground">{assignment.maxPoints}</span></span>
              {assignment.allowsLate ? (
                <Badge variant="secondary">Late submissions allowed</Badge>
              ) : (
                <Badge variant="warning">No late submissions</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sidebar info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1">
              <p className="text-muted-foreground">Due</p>
              <p className="font-medium">{dueAt ? format(dueAt, 'MMM d, yyyy · h:mm a') : '—'}</p>
            </div>
            <Separator />
            <div className="space-y-1">
              <p className="text-muted-foreground">Max points</p>
              <p className="font-medium">{assignment.maxPoints}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">File submissions</p>
              <p className="font-medium">{assignment.allowsFile ? 'Allowed' : 'Not allowed'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Submission form (student only) */}
      {!staff ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submit your answer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {submitted ? (
              <div className="rounded-lg bg-success/10 px-4 py-6 text-center">
                <p className="text-sm font-medium text-success">Submission received!</p>
                <p className="mt-1 text-xs text-muted-foreground">Your teacher will grade it soon.</p>
              </div>
            ) : (
              <>
                {assignment.allowsFile ? (
                  <FilePicker
                    accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg"
                    name={file ? file.name : null}
                    onFile={setFile}
                    onClear={() => setFile(null)}
                    uploading={uploading}
                    progress={uploadProgress}
                    label="Attach a file"
                  />
                ) : null}
                <Textarea
                  rows={8}
                  placeholder="Write your answer here…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button onClick={handleSubmit} disabled={submit.isPending || uploading || (!body.trim() && !file)}>
                    <Send className="mr-1" aria-hidden /> Submit assignment
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Submission grading is available in the backend admin tools. The student view is at /courses/:id/learn.
          </CardContent>
        </Card>
      )}
    </div>
  );
}