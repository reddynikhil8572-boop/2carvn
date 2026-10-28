import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarClock, Check, Clock3, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';

import * as allocationApi from '@/api/teacher-allocations';
import { useSchools } from '@/hooks/useSchools';
import {
  useAddTimetableSlot,
  useAllocationWorkspace,
  useCreateAllocation,
  useDecideAllocationRequest,
  useMyAllocations,
  useRemoveTimetableSlot,
  useSetMyAvailability,
  useSetTeacherAvailability,
  useSubmitAllocationRequest,
} from '@/hooks/useTeacherAllocations';
import { useAuthUser } from '@/stores/auth';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};
const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const displayTime = (minutes: number) => {
  const hour = Math.floor(minutes / 60);
  const minute = String(minutes % 60).padStart(2, '0');
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
};

export function TeacherAllocationsPage() {
  const user = useAuthUser();
  const { data: schools = [], isLoading: schoolsLoading } = useSchools(user?.role === 'ADMIN');
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const schoolId = selectedSchoolId || schools[0]?.id || '';
  const isPlatformAdmin = user?.role === 'ADMIN';
  const isSchoolAdmin = user?.role === 'ORGANISER';
  const isTeacher = user?.role === 'TEACHER';

  const workspaceQuery = useAllocationWorkspace(user?.role ?? 'STUDENT', schoolId);
  const personalQuery = useMyAllocations(user?.role === 'TEACHER');
  const workspace = workspaceQuery.data;
  const personal = personalQuery.data;

  const createAllocation = useCreateAllocation(schoolId);
  const submitRequest = useSubmitAllocationRequest();
  const decideRequest = useDecideAllocationRequest();
  const addTimetableSlot = useAddTimetableSlot(schoolId);
  const removeTimetableSlot = useRemoveTimetableSlot(schoolId);
  const setTeacherAvailability = useSetTeacherAvailability(schoolId);
  const setMyAvailability = useSetMyAvailability();

  const [teacherId, setTeacherId] = useState('');
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);

  useEffect(() => {
    if (workspace?.teachers.length && !workspace.teachers.some((teacher) => teacher.id === teacherId)) {
      setTeacherId(workspace.teachers[0]!.id);
    }
  }, [teacherId, workspace?.teachers]);

  const loading = isTeacher ? personalQuery.isLoading : workspaceQuery.isLoading || (isPlatformAdmin && schoolsLoading);
  const error = isTeacher ? personalQuery.error : workspaceQuery.error;
  const refetch = isTeacher ? personalQuery.refetch : workspaceQuery.refetch;
  const allocations = isTeacher ? personal?.allocations ?? [] : workspace?.allocations ?? [];
  const currentAvailability = isTeacher
    ? personal?.availability ?? []
    : workspace?.availabilities.filter((item) => item.teacherId === teacherId) ?? [];

  async function handleAllocationSubmit(payload: allocationApi.AllocationPayload | allocationApi.AllocationRequestPayload) {
    try {
      if (isPlatformAdmin) {
        await createAllocation.mutateAsync(payload);
        toast.success('Teacher assignment created');
      } else {
        await submitRequest.mutateAsync(payload as allocationApi.AllocationRequestPayload);
        toast.success('Assignment request submitted for approval');
      }
      setShowAssignmentForm(false);
    } catch {
      // The global mutation toast displays the API error.
    }
  }

  async function handleDecision(requestId: string, decision: 'APPROVED' | 'REJECTED') {
    try {
      await decideRequest.mutateAsync({ requestId, decision });
      toast.success(decision === 'APPROVED' ? 'Request approved and assignment activated' : 'Request declined');
    } catch {
      // The global mutation toast displays the API error.
    }
  }

  async function handleAvailabilitySave(availability: allocationApi.AvailabilityWindow[]) {
    try {
      if (isTeacher) {
        await setMyAvailability.mutateAsync(availability);
      } else {
        await setTeacherAvailability.mutateAsync({ teacherId, availability });
      }
      toast.success('Availability saved');
    } catch {
      // The global mutation toast displays the API error.
    }
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isTeacher ? 'My teaching schedule' : 'Teacher allocation'}
        description={
          isPlatformAdmin
            ? 'Manage teacher assignments, availability, timetable coverage, and school requests.'
            : isSchoolAdmin
              ? 'View your school’s teacher assignments and request staffing changes.'
              : 'View your assigned classes, students, subjects, sections, and timetable.'
        }
      >
        {isPlatformAdmin || isSchoolAdmin ? (
          <Button size="sm" onClick={() => setShowAssignmentForm((open) => !open)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            {isPlatformAdmin ? 'Assign teacher' : 'Request assignment'}
          </Button>
        ) : null}
      </PageHeader>

      {isPlatformAdmin ? (
        <div className="max-w-sm space-y-2">
          <Label htmlFor="allocation-school">School</Label>
          <Select value={schoolId} onValueChange={setSelectedSchoolId}>
            <SelectTrigger id="allocation-school" aria-label="School">
              <SelectValue placeholder="Choose a school" />
            </SelectTrigger>
            <SelectContent>
              {schools.map((school) => (
                <SelectItem key={school.id} value={school.id}>{school.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {showAssignmentForm && (isPlatformAdmin || isSchoolAdmin) ? (
        <AllocationForm
          teachers={workspace?.teachers ?? []}
          classes={workspace?.classes ?? []}
          allocations={allocations}
          isAdmin={isPlatformAdmin}
          isPending={createAllocation.isPending || submitRequest.isPending}
          onCancel={() => setShowAssignmentForm(false)}
          onSubmit={handleAllocationSubmit}
        />
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : error ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : null}

      {!loading && !error && !isTeacher && workspace?.warnings.length ? (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
              Staffing alerts
            </CardTitle>
            <CardDescription>Review these coverage and workload items.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {workspace.warnings.map((warning, index) => (
              <div key={`${warning.code}-${warning.entityId ?? index}`} className="flex gap-2 text-sm">
                <Badge variant={warning.code === 'EXCESSIVE_WORKLOAD' ? 'warning' : 'outline'}>
                  {warning.code === 'EXCESSIVE_WORKLOAD'
                    ? 'Workload'
                    : warning.code === 'UNASSIGNED_CLASS'
                      ? 'Unassigned class'
                      : 'Unstaffed subject'}
                </Badge>
                <span>{warning.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {!loading && !error && isTeacher ? (
        <TeacherAllocations allocations={allocations} />
      ) : null}

      {!loading && !error && (isPlatformAdmin || isSchoolAdmin) ? (
        <>
          {isPlatformAdmin && workspace?.teachers.length ? (
            <AvailabilityEditor
              title="Teacher availability"
              description="Set recurring weekly availability. Timetable slots must fit within configured windows."
              teachers={workspace.teachers}
              selectedTeacherId={teacherId}
              onTeacherChange={setTeacherId}
              availability={currentAvailability}
              onSave={handleAvailabilitySave}
              isPending={setTeacherAvailability.isPending}
            />
          ) : null}
          <AllocationList
            allocations={allocations}
            canEditTimetable={isPlatformAdmin}
            schoolId={schoolId}
            onAddTimetableSlot={(allocationId, payload) =>
              addTimetableSlot.mutateAsync({ allocationId, payload })
            }
            onRemoveTimetableSlot={(allocationId, slotId) =>
              removeTimetableSlot.mutateAsync({ allocationId, slotId })
            }
          />
          {isTeacher ? null : <AllocationRequests
            requests={workspace?.requests ?? []}
            canDecide={isPlatformAdmin}
            onDecision={handleDecision}
          />}
        </>
      ) : null}

      {!loading && !error && isTeacher ? (
        <AvailabilityEditor
          title="My availability"
          description="Update your regular weekly hours. Existing timetable periods must remain available."
          availability={currentAvailability}
          onSave={handleAvailabilitySave}
          isPending={setMyAvailability.isPending}
        />
      ) : null}
    </div>
  );
}

function AllocationForm({
  teachers,
  classes,
  allocations,
  isAdmin,
  isPending,
  onCancel,
  onSubmit,
}: {
  teachers: Array<{ id: string; name: string }>;
  classes: Array<{ id: string; name: string; academicYear: string }>;
  allocations: allocationApi.TeacherAllocation[];
  isAdmin: boolean;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (payload: allocationApi.AllocationPayload | allocationApi.AllocationRequestPayload) => void;
}) {
  const [teacherId, setTeacherId] = useState('');
  const [classId, setClassId] = useState('');
  const [subject, setSubject] = useState('');
  const [section, setSection] = useState('');
  const [weeklyHours, setWeeklyHours] = useState('4');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [type, setType] = useState<'ASSIGN' | 'REPLACE' | 'REASSIGN'>('ASSIGN');
  const [targetAllocationId, setTargetAllocationId] = useState('');
  const [substituteForId, setSubstituteForId] = useState('');
  const [replacesAllocationId, setReplacesAllocationId] = useState('');
  const [note, setNote] = useState('');

  const chosenTeacherId = teacherId || teachers[0]?.id || '';
  const chosenClassId = classId || classes[0]?.id || '';
  const activeAllocations = allocations.filter((allocation) => allocation.isActive);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const basePayload = {
      teacherId: chosenTeacherId,
      classId: chosenClassId,
      subject: subject.trim(),
      section: section.trim(),
      weeklyHours: Number(weeklyHours),
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
    };
    if (isAdmin) {
      onSubmit({
        ...basePayload,
        ...(substituteForId ? { substituteForId } : {}),
        ...(replacesAllocationId ? { replacesAllocationId } : {}),
      });
    } else {
      onSubmit({
        ...basePayload,
        type,
        ...(targetAllocationId ? { targetAllocationId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{isAdmin ? 'New teacher assignment' : 'Request a teacher assignment'}</CardTitle>
        <CardDescription>
          {isAdmin
            ? 'Assignments take effect immediately and are recorded in the audit history.'
            : 'A platform administrator must approve your request before assignments change.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submit}>
          <FormField label="Teacher">
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={chosenTeacherId} onChange={(e) => setTeacherId(e.target.value)} required>
              {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
            </select>
          </FormField>
          <FormField label="Class">
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={chosenClassId} onChange={(e) => setClassId(e.target.value)} required>
              {classes.map((klass) => <option key={klass.id} value={klass.id}>{klass.name} · {klass.academicYear}</option>)}
            </select>
          </FormField>
          <FormField label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={100} required />
          </FormField>
          <FormField label="Section">
            <Input value={section} onChange={(e) => setSection(e.target.value)} maxLength={40} placeholder="e.g. A" required />
          </FormField>
          <FormField label="Weekly hours">
            <Input type="number" min="0.5" max="60" step="0.5" value={weeklyHours} onChange={(e) => setWeeklyHours(e.target.value)} required />
          </FormField>
          <FormField label="Start date (optional)">
            <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required={Boolean(substituteForId)} />
          </FormField>
          <FormField label="End date (optional)">
            <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required={Boolean(substituteForId)} />
          </FormField>
          {isAdmin ? (
            <>
              <FormField label="Replace existing assignment (optional)">
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={replacesAllocationId || 'none'}
                  onChange={(e) => {
                    setReplacesAllocationId(e.target.value === 'none' ? '' : e.target.value);
                    setSubstituteForId('');
                  }}
                >
                  <option value="none">Keep existing assignments</option>
                  {activeAllocations.map((allocation) => (
                    <option key={allocation.id} value={allocation.id}>
                      {allocation.teacher?.name ?? 'Teacher'} · {allocation.class.name} · {allocation.subject} ({allocation.section})
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Temporary substitution (optional)">
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={substituteForId || 'none'}
                  disabled={Boolean(replacesAllocationId)}
                  onChange={(e) => {
                    setSubstituteForId(e.target.value === 'none' ? '' : e.target.value);
                    setReplacesAllocationId('');
                  }}
                >
                  <option value="none">Not a substitute</option>
                  {activeAllocations.map((allocation) => (
                    <option key={allocation.id} value={allocation.id}>
                      {allocation.teacher?.name ?? 'Teacher'} · {allocation.class.name} · {allocation.subject}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          ) : (
            <>
              <FormField label="Request type">
                <select className="h-10 rounded-md border bg-background px-3 text-sm" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                  <option value="ASSIGN">Assign</option>
                  <option value="REPLACE">Replace</option>
                  <option value="REASSIGN">Reassign</option>
                </select>
              </FormField>
              {type !== 'ASSIGN' ? (
                <FormField label="Existing assignment">
                  <select className="h-10 rounded-md border bg-background px-3 text-sm" value={targetAllocationId} onChange={(e) => setTargetAllocationId(e.target.value)} required>
                    <option value="">Select an assignment</option>
                    {activeAllocations.map((allocation) => (
                      <option key={allocation.id} value={allocation.id}>
                        {allocation.teacher?.name ?? 'Teacher'} · {allocation.class.name} · {allocation.subject} ({allocation.section})
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}
              <FormField label="Request note">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional context" />
              </FormField>
            </>
          )}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={isPending || !chosenTeacherId || !chosenClassId}>
              {isPending ? 'Saving…' : isAdmin ? 'Assign teacher' : 'Submit request'}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function AllocationList({
  allocations,
  canEditTimetable,
  schoolId,
  onAddTimetableSlot,
  onRemoveTimetableSlot,
}: {
  allocations: allocationApi.TeacherAllocation[];
  canEditTimetable: boolean;
  schoolId: string;
  onAddTimetableSlot: (allocationId: string, payload: allocationApi.TimetablePayload) => Promise<unknown>;
  onRemoveTimetableSlot: (allocationId: string, slotId: string) => Promise<unknown>;
}) {
  const [pendingSlot, setPendingSlot] = useState('');
  const visibleAllocations = useMemo(
    () => [...allocations].sort((a, b) => Number(b.isActive) - Number(a.isActive)),
    [allocations],
  );

  if (visibleAllocations.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No teacher assignments have been recorded for this school yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Assignments</h2>
      {visibleAllocations.map((allocation) => (
        <AllocationCard
          key={allocation.id}
          allocation={allocation}
          canEditTimetable={canEditTimetable}
          schoolId={schoolId}
          pending={pendingSlot === allocation.id}
          onPendingChange={(pending) => setPendingSlot(pending ? allocation.id : '')}
          onAddTimetableSlot={onAddTimetableSlot}
          onRemoveTimetableSlot={onRemoveTimetableSlot}
        />
      ))}
    </section>
  );
}

function AllocationCard({
  allocation,
  canEditTimetable,
  schoolId,
  pending,
  onPendingChange,
  onAddTimetableSlot,
  onRemoveTimetableSlot,
}: {
  allocation: allocationApi.TeacherAllocation;
  canEditTimetable: boolean;
  schoolId: string;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onAddTimetableSlot: (allocationId: string, payload: allocationApi.TimetablePayload) => Promise<unknown>;
  onRemoveTimetableSlot: (allocationId: string, slotId: string) => Promise<unknown>;
}) {
  const [weekday, setWeekday] = useState('0');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const students = allocation.class.enrollments?.map((entry) => entry.student) ?? [];

  async function submitSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onPendingChange(true);
    try {
      await onAddTimetableSlot(allocation.id, {
        weekday: Number(weekday),
        startMinute: toMinutes(startTime),
        endMinute: toMinutes(endTime),
      });
      toast.success('Timetable period saved');
    } catch {
      // The global mutation toast displays conflicts, including teacher/class overlaps.
    } finally {
      onPendingChange(false);
    }
  }

  async function removeSlot(slotId: string) {
    try {
      await onRemoveTimetableSlot(allocation.id, slotId);
      toast.success('Timetable period removed');
    } catch {
      // The global mutation toast displays the API error.
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{allocation.subject}</h3>
              <Badge variant={allocation.isActive ? 'success' : 'secondary'}>
                {allocation.isActive ? 'Active' : 'Inactive'}
              </Badge>
              {allocation.substituteFor ? <Badge variant="outline">Temporary substitute</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {allocation.teacher?.name ?? 'You'} · {allocation.class.name} · Section {allocation.section} · {allocation.weeklyHours} hrs/week
            </p>
            {allocation.startsAt || allocation.endsAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {allocation.startsAt ?? 'Any start'} to {allocation.endsAt ?? 'No end date'}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Users className="h-4 w-4" aria-hidden />
            {students.length} student{students.length === 1 ? '' : 's'}
          </div>
        </div>

        {students.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">View assigned students</summary>
            <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
              {students.map((student) => <li key={student.id}>{student.name} · {student.email}</li>)}
            </ul>
          </details>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {allocation.timetableSlots.map((slot) => (
            <div key={slot.id} className="flex items-center gap-1">
              <Badge variant="outline" className="font-normal">
                <CalendarClock className="mr-1 h-3 w-3" aria-hidden />
                {weekdays[slot.weekday]} {displayTime(slot.startMinute)}–{displayTime(slot.endMinute)}
              </Badge>
              {canEditTimetable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  aria-label={`Remove ${weekdays[slot.weekday]} timetable period`}
                  onClick={() => void removeSlot(slot.id)}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          {!allocation.timetableSlots.length ? (
            <span className="text-sm text-muted-foreground">No timetable periods configured.</span>
          ) : null}
        </div>

        {canEditTimetable && allocation.isActive ? (
          <form onSubmit={submitSlot} className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="grid gap-1">
              <Label htmlFor={`day-${allocation.id}`}>Day</Label>
              <select id={`day-${allocation.id}`} className="h-10 rounded-md border bg-background px-3 text-sm" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`start-${allocation.id}`}>Start</Label>
              <Input id={`start-${allocation.id}`} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`end-${allocation.id}`}>End</Label>
              <Input id={`end-${allocation.id}`} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={pending || !schoolId}>
              <Clock3 className="mr-1 h-4 w-4" aria-hidden />
              {pending ? 'Saving…' : 'Add period'}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AllocationRequests({
  requests,
  canDecide,
  onDecision,
}: {
  requests: allocationApi.AllocationRequest[];
  canDecide: boolean;
  onDecision: (requestId: string, decision: 'APPROVED' | 'REJECTED') => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Assignment requests</h2>
      {requests.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No assignment requests.</CardContent></Card>
      ) : requests.map((request) => (
        <Card key={request.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{request.type.toLowerCase()} · {request.subject}</span>
                <Badge variant={request.status === 'PENDING' ? 'warning' : request.status === 'APPROVED' ? 'success' : 'secondary'}>
                  {request.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {request.teacher.name} · {request.class.name} · Section {request.section} · requested by {request.requester.name}
              </p>
              {request.note ? <p className="mt-1 text-sm">{request.note}</p> : null}
              {request.decisionNote ? <p className="mt-1 text-xs text-muted-foreground">{request.decisionNote}</p> : null}
            </div>
            {canDecide && request.status === 'PENDING' ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onDecision(request.id, 'APPROVED')}>
                  <Check className="mr-1 h-4 w-4" aria-hidden /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => onDecision(request.id, 'REJECTED')}>Decline</Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function TeacherAllocations({ allocations }: { allocations: allocationApi.TeacherAllocation[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">My assignments</h2>
      {allocations.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">You do not have any active teacher allocations yet.</CardContent></Card>
      ) : allocations.map((allocation) => (
        <AllocationCard
          key={allocation.id}
          allocation={allocation}
          canEditTimetable={false}
          schoolId={allocation.schoolId}
          pending={false}
          onPendingChange={() => undefined}
          onAddTimetableSlot={async () => undefined}
          onRemoveTimetableSlot={async () => undefined}
        />
      ))}
    </section>
  );
}

interface AvailabilityDraft {
  key: string;
  weekday: number;
  start: string;
  end: string;
}

function AvailabilityEditor({
  title,
  description,
  teachers,
  selectedTeacherId,
  onTeacherChange,
  availability,
  onSave,
  isPending,
}: {
  title: string;
  description: string;
  teachers?: Array<{ id: string; name: string }>;
  selectedTeacherId?: string;
  onTeacherChange?: (id: string) => void;
  availability: allocationApi.TeacherAvailability[];
  onSave: (availability: allocationApi.AvailabilityWindow[]) => Promise<void>;
  isPending: boolean;
}) {
  const [drafts, setDrafts] = useState<AvailabilityDraft[]>([]);

  useEffect(() => {
    setDrafts(availability.map((window) => ({
      key: window.id,
      weekday: window.weekday,
      start: toTime(window.startMinute),
      end: toTime(window.endMinute),
    })));
  }, [availability]);

  function updateDraft(key: string, field: 'start' | 'end', value: string) {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, [field]: value } : draft));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const windows = drafts.map((draft) => ({
      weekday: draft.weekday,
      startMinute: toMinutes(draft.start),
      endMinute: toMinutes(draft.end),
    }));
    await onSave(windows);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void save(event)} className="space-y-4">
          {teachers && selectedTeacherId && onTeacherChange ? (
            <div className="max-w-sm space-y-2">
              <Label htmlFor="availability-teacher">Teacher</Label>
              <Select value={selectedTeacherId} onValueChange={onTeacherChange}>
                <SelectTrigger id="availability-teacher"><SelectValue /></SelectTrigger>
                <SelectContent>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-3">
            {weekdays.map((day, weekday) => {
              const rows = drafts.filter((draft) => draft.weekday === weekday);
              return (
                <div key={day} className="flex flex-wrap items-center gap-2 border-b pb-3 last:border-0">
                  <span className="w-24 text-sm font-medium">{day}</span>
                  {rows.map((row) => (
                    <div key={row.key} className="flex items-end gap-2">
                      <div className="grid gap-1">
                        <Label className="sr-only" htmlFor={`avail-start-${row.key}`}>{day} start</Label>
                        <Input id={`avail-start-${row.key}`} type="time" value={row.start} onChange={(e) => updateDraft(row.key, 'start', e.target.value)} required />
                      </div>
                      <span className="pb-2 text-muted-foreground">to</span>
                      <div className="grid gap-1">
                        <Label className="sr-only" htmlFor={`avail-end-${row.key}`}>{day} end</Label>
                        <Input id={`avail-end-${row.key}`} type="time" value={row.end} onChange={(e) => updateDraft(row.key, 'end', e.target.value)} required />
                      </div>
                      <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${day} availability`} onClick={() => setDrafts((current) => current.filter((draft) => draft.key !== row.key))}>Remove</Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDrafts((current) => [...current, {
                      key: `${weekday}-${Date.now()}-${Math.random()}`,
                      weekday,
                      start: '09:00',
                      end: '17:00',
                    }])}
                  >
                    <Plus className="mr-1 h-3 w-3" aria-hidden /> Add window
                  </Button>
                </div>
              );
            })}
          </div>
          <Button type="submit" disabled={isPending || Boolean(teachers?.length && !selectedTeacherId)}>
            {isPending ? 'Saving…' : 'Save availability'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
