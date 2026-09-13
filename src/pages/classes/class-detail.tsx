import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthUser } from '@/stores/auth';
import { useClasses, useEnrolStudent, useEnrollments } from '@/hooks/useClasses';
import { useUsers } from '@/hooks/useUsers';
import { isSchoolAdmin } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function ClassDetailPage() {
  const { id } = useParams<'id'>();
  const user = useAuthUser();
  const isAdmin = user ? isSchoolAdmin(user.role) : false;

  const [enrolOpen, setEnrolOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');

  const { data: classes = [], isLoading, error, refetch } = useClasses();
  const cls = classes.find((c) => c.id === id) ?? null;

  const {
    data: enrollments = [],
    isLoading: isEnrollmentsLoading,
    error: enrollmentsError,
    refetch: refetchEnrollments,
  } = useEnrollments(id ?? '');
  const enrolStudent = useEnrolStudent(id ?? '');

  const { data: users = [] } = useUsers();

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Class unavailable" description="We couldn't load this class." />
        <ErrorState
          title="Couldn't load the class"
          description="Something went wrong while fetching its details."
          onRetry={refetch}
        />
      </div>
    );
  }

  if (!isLoading && !cls) {
    return (
      <div className="space-y-6">
        <PageHeader title="Class not found" description="This class may have been deleted." />
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              We couldn't find the class you're looking for. Check the URL or head back to your
              classes.
            </p>
            <Link to="/classes" className={buttonVariants({ variant: 'outline' })}>
              Back to classes
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const enrolledStudentIds = new Set(enrollments.map((e) => e.studentId));
  const candidates = users.filter((u) => u.role === 'STUDENT' && !enrolledStudentIds.has(u.id));

  async function handleEnrol() {
    if (!selectedStudentId) return;
    try {
      await enrolStudent.mutateAsync(selectedStudentId);
      toast.success('Student enrolled');
      setEnrolOpen(false);
      setSelectedStudentId('');
    } catch {
      /* global mutation toast covers the failure */
    }
  }

  return (
    <div className="space-y-6">
      {cls ? (
        <PageHeader
          title={cls.name}
          description={`${cls.academicYear} · ${cls.teacher?.name ?? 'No teacher'}`}
        >
          {isAdmin ? (
            <Button size="sm" onClick={() => setEnrolOpen(true)}>
              <UserPlus className="mr-1" aria-hidden /> Enrol student
            </Button>
          ) : null}
        </PageHeader>
      ) : (
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Enrolled students</CardTitle>
          <CardDescription>
            {isEnrollmentsLoading ? 'Loading…' : `${enrollments.length} enrolled`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isEnrollmentsLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : enrollmentsError ? (
            <ErrorState
              title="Couldn't load enrollments"
              description="Something went wrong while fetching the enrolled students."
              onRetry={refetchEnrollments}
            />
          ) : enrollments.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No students enrolled"
              description="Enrol students to this class to get started."
              action={
                isAdmin ? (
                  <Button size="sm" onClick={() => setEnrolOpen(true)}>
                    <UserPlus className="mr-1" aria-hidden /> Enrol student
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Enrolled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.student.name}</TableCell>
                    <TableCell className="text-muted-foreground">{e.student.email}</TableCell>
                    <TableCell className="whitespace-nowrap">{format(new Date(e.enrolledAt), 'PP')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={enrolOpen} onOpenChange={setEnrolOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enrol student</DialogTitle>
            <DialogDescription>
              Add a student to {cls?.name ?? 'this class'}. Only students who aren't already
              enrolled are shown.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">Student</label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a student…" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.length > 0 ? (
                    candidates.map((student) => (
                      <SelectItem key={student.id} value={student.id}>
                        {student.name} · {student.email}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="~" disabled>
                      No students available to enrol
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEnrolOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleEnrol}
                disabled={enrolStudent.isPending || !selectedStudentId}
              >
                {enrolStudent.isPending ? 'Enrolling…' : 'Enrol student'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}