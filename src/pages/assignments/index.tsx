import { Link } from 'react-router-dom';
import { FileText, Send } from 'lucide-react';

import { useCourses, useCourse } from '@/hooks/useCourses';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';
import type { LessonItemView } from '@/types/models';

/**
 * Assignments are nested inside the course tree (lesson items with kind ASSIGNMENT).
 * There is no global assignments endpoint; this page is course-scoped:
 * pick a course → list its assignment items → link to /assignments/:id.
 */
export function AssignmentsPage() {
  const { data: courses = [], isLoading: coursesLoading, error: coursesError, refetch: refetchCourses } = useCourses();
  const [courseId, setCourseId] = useState('');
  const enabledCourseId = courseId || courses[0]?.id || '';

  const { data: course, isLoading: treeLoading, error: treeError, refetch: refetchTree } = useCourse(enabledCourseId);

  const assignmentItems = course
    ? course.modules.flatMap((m) =>
        m.chapters.flatMap((ch) =>
          ch.lessons.flatMap((l) =>
            l.items.filter((i) => i.kind === 'ASSIGNMENT' && i.isPublished),
          ),
        ),
      )
    : [];

  const totalModules = course?.modules.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Assignments" description="View and submit assignments for a course." />

      <Card>
        <CardContent className="p-4">
          {coursesLoading ? (
            <Skeleton className="h-10 w-64" />
          ) : coursesError ? (
            <ErrorState
              title="Couldn't load courses"
              description="Selecting a course is needed to list assignments."
              onRetry={refetchCourses}
            />
          ) : (
            <Select value={enabledCourseId} onValueChange={setCourseId}>
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

      {treeLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      ) : treeError ? (
        <ErrorState onRetry={refetchTree} />
      ) : assignmentItems.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {course
              ? 'No published assignments in this course yet.'
              : 'Select a course to see assignments.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {assignmentItems.length} assignment{assignmentItems.length !== 1 ? 's' : ''} across {totalModules} module{totalModules !== 1 ? 's' : ''}
          </p>
          {assignmentItems.map((item) => (
            <AssignmentRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssignmentRow({ item }: { item: LessonItemView }) {
  return (
    <Link
      to={`/assignments/${item.id}`}
      className="group flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-accent/60"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <FileText className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium group-hover:text-primary transition-colors">
          {item.title}
        </p>
        <p className="text-xs text-muted-foreground">Lesson item</p>
      </div>
      <Badge variant="secondary">Assignment</Badge>
      <Send className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden />
    </Link>
  );
}