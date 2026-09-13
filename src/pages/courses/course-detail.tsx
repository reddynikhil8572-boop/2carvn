import { Link, useParams } from 'react-router-dom';
import { BookOpen, Edit, GraduationCap, PlayCircle } from 'lucide-react';

import { useAuthUser } from '@/stores/auth';
import { useCourse } from '@/hooks/useCourses';
import { useCoverUrl } from '@/hooks/useUpload';
import { isStaff } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CenteredLoader } from '@/components/auth/route-guards';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import type { ChapterView, ModuleView } from '@/types/models';

function ItemIcon({ kind }: { kind: 'VIDEO' | 'QUIZ' | 'ASSIGNMENT' }) {
  if (kind === 'VIDEO') return <PlayCircle className="h-4 w-4" aria-hidden />;
  if (kind === 'QUIZ') return <div className="flex h-4 w-4 items-center justify-center rounded-sm bg-warning/20 text-[10px] font-bold text-warning">?</div>;
  return <div className="flex h-4 w-4 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">A</div>;
}

function ModuleCard({ module }: { module: ModuleView }) {
  return (
    <Accordion type="multiple" defaultValue={[module.id]} className="w-full">
      <AccordionItem value={module.id} className="border-none">
        <AccordionTrigger className="rounded-lg px-3 hover:no-underline data-[state=open]:bg-accent/60">
          <span className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span>{module.title}</span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-1 pt-1">
          <div className="space-y-1">
            {module.chapters.map((chapter: ChapterView) => (
              <div key={chapter.id} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{chapter.title}</p>
                <ul className="mt-2 space-y-1">
                  {chapter.lessons.map((lesson) => (
                    <li key={lesson.id} className="rounded-md px-2 py-1.5 hover:bg-accent/50">
                      <p className="text-sm text-muted-foreground">{lesson.title}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {lesson.items.map((item) => (
                          <span
                            key={item.id}
                            className={cn(
                              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground',
                              !item.isPublished && 'opacity-50',
                            )}
                          >
                            <ItemIcon kind={item.kind} />
                            {item.title}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {module.chapters.length === 0 ? (
              <p className="px-3 text-sm text-muted-foreground">No chapters yet.</p>
            ) : null}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

const statusTone: Record<string, 'secondary' | 'success' | 'warning'> = {
  DRAFT: 'secondary',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

export function CourseDetailPage() {
  const { id } = useParams<'id'>();
  const user = useAuthUser();
  const staff = user ? isStaff(user.role) : false;
  const { data: course, isLoading, error } = useCourse(id ?? '');
  const { data: cover } = useCoverUrl(id ?? '');

  if (isLoading) return <CenteredLoader label="Loading course…" />;
  if (error && !course) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold">Course not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          It may have been removed, or you don't have access to it.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/courses">Back to courses</Link>
        </Button>
      </div>
    );
  }

  const lessonItemCount = course?.modules.reduce(
    (sum, m) =>
      sum + m.chapters.reduce(
        (s, ch) => s + ch.lessons.reduce((ls, l) => ls + l.items.length, 0),
        0,
      ),
    0,
  );
  const chapterCount = course?.modules.reduce((s, m) => s + m.chapters.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={course?.title ?? 'Course'}
        description={course?.description ?? 'No description.'}
      >
        {course ? (
          <div className="flex items-center gap-2">
            <Badge variant={statusTone[course.status]}>{course.status}</Badge>
            {staff ? (
              <>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/courses/${course.id}/learn`}>
                    <PlayCircle className="mr-1" aria-hidden /> Preview
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link to={`/courses/${course.id}/edit`}>
                    <Edit className="mr-1" aria-hidden /> Edit
                  </Link>
                </Button>
              </>
            ) : (
              <Button asChild size="sm">
                <Link to={`/courses/${course.id}/learn`}>
                  <PlayCircle className="mr-1" aria-hidden /> Continue learning
                </Link>
              </Button>
            )}
          </div>
        ) : null}
      </PageHeader>

      {cover?.url ? (
        <img
          src={cover.url}
          alt={course?.title ? `${course.title} cover` : 'Course cover'}
          className="h-44 w-full rounded-lg border border-border object-cover sm:h-56"
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <BookOpen className="h-5 w-5 text-primary" aria-hidden />
            <div>
              <p className="text-xs text-muted-foreground">Modules</p>
              <p className="text-lg font-semibold">{course?.modules.length ?? '…'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden />
            <div>
              <p className="text-xs text-muted-foreground">Chapters</p>
              <p className="text-lg font-semibold">{chapterCount ?? '…'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <PlayCircle className="h-5 w-5 text-primary" aria-hidden />
            <div>
              <p className="text-xs text-muted-foreground">Lesson activities</p>
              <p className="text-lg font-semibold">{lessonItemCount ?? '…'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Structure</h2>
          <Card>
            <CardContent className="p-3">
              {course && course.modules.length > 0 ? (
                <div className="space-y-1">
                  {course.modules.map((m) => <ModuleCard key={m.id} module={m} />)}
                </div>
              ) : (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {staff
                    ? 'No modules yet — open the editor to build the course structure.'
                    : 'This course has no published content yet.'}
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Assigned to</h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Classes</CardTitle>
            </CardHeader>
            <CardContent>
              {course && course.assignments.length > 0 ? (
                <ul className="space-y-2">
                  {course.assignments.map((a) => (
                    <li key={a.id}>
                      <Link
                        to={`/classes/${a.classId}`}
                        className="block rounded-md border p-2.5 text-sm font-medium transition-colors hover:bg-accent"
                      >
                        {a.class.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {staff ? 'Assign this course to a class to make it visible to learners.' : 'Not assigned.'}
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}