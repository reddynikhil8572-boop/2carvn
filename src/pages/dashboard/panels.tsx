import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Award,
  BookOpen,
  Building2,
  FileCheck2,
  GraduationCap,
  PlayCircle,
  Users,
} from 'lucide-react';

import { useCourses } from '@/hooks/useCourses';
import { useClasses } from '@/hooks/useClasses';
import { useSchools } from '@/hooks/useSchools';
import { StatCard } from '@/components/stat-card';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { CourseSummary } from '@/types/models';
import type { CourseStatus } from '@/types/api';

const statusTone: Record<CourseStatus, 'secondary' | 'success' | 'warning'> = {
  DRAFT: 'secondary',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

function CourseCard({ course, delay = 0 }: { course: CourseSummary; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
    >
      <Link to={`/courses/${course.id}`} className="block group">
        <Card className="h-full transition-shadow hover:shadow-md">
          <CardContent className="flex h-full flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <Badge variant={statusTone[course.status]}>{course.status}</Badge>
              <span className="text-xs text-muted-foreground">
                {course._count?.modules ?? 0} modules
              </span>
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold leading-snug group-hover:text-primary">
                {course.title}
              </h3>
              {course.subject ? (
                <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{course.subject}</p>
              ) : null}
            </div>
            <p className="mt-auto line-clamp-2 text-sm text-muted-foreground">
              {course.description ?? 'No description yet.'}
            </p>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

// ── SUPER_ADMIN ─────────────────────────────────────────────────────────────

export function SuperAdminPanel() {
  const { data: schools = [], isLoading, error, refetch } = useSchools();

  const active = schools.filter((s) => s.isActive).length;
  const totalStudents = schools.reduce((sum, s) => sum + (s.userCount ?? 0), 0);
  // Number of distinct plan tiers actually in use across live schools — derived
  // from the real list response, never hardcoded.
  const distinctPlans = new Set(schools.map((s) => s.plan)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description="All schools on the 2carvn platform."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={Building2} label="Total schools" value={isLoading || error ? '…' : schools.length} hint={`${active} active`} delay={0} />
        <StatCard icon={Users} label="User seats sold" value={isLoading || error ? '…' : totalStudents} hint="across all tenants" delay={0.05} />
        <StatCard icon={Award} label="Plans in use" value={isLoading || error ? '…' : distinctPlans} hint="BASIC → ENTERPRISE" delay={0.1} />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : error ? (
        <ErrorState onRetry={refetch} />
      ) : schools.length === 0 ? (
        <EmptyState icon={Building2} title="No schools yet" description="Schools appear here once they're created." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schools</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {schools.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.schoolCode} · {s.plan}</p>
                </div>
                <Badge variant={s.isActive ? 'success' : 'warning'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── SCHOOL_ADMIN ───────────────────────────────────────────────────────────

export function SchoolAdminPanel() {
  const {
    data: classes = [],
    isLoading: classesLoading,
    error: classesError,
    refetch: refetchClasses,
  } = useClasses();
  const {
    data: courses = [],
    isLoading: coursesLoading,
    error: coursesError,
    refetch: refetchCourses,
  } = useCourses();

  const students = classes.reduce((sum, c) => sum + (c._count?.enrollments ?? 0), 0);
  const published = courses.filter((c) => c.status === 'PUBLISHED').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="School overview"
        description="Manage classes, users and the courses your teachers teach."
      >
        <Button asChild size="sm">
          <Link to="/classes">Manage classes</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={GraduationCap} label="Classes" value={classesLoading || classesError ? '…' : classes.length} delay={0} />
        <StatCard icon={Users} label="Students enrolled" value={classesLoading || classesError ? '…' : students} delay={0.05} />
        <StatCard icon={BookOpen} label="Courses" value={coursesLoading || coursesError ? '…' : courses.length} delay={0.1} />
        <StatCard icon={FileCheck2} label="Published" value={coursesLoading || coursesError ? '…' : published} delay={0.15} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Recent classes</h2>
          {classesLoading ? (
            <Skeleton className="h-40" />
          ) : classesError ? (
            <ErrorState onRetry={refetchClasses} />
          ) : classes.length === 0 ? (
            <EmptyState icon={GraduationCap} title="No classes yet" description="Create a class to start enrolling students." />
          ) : (
            <div className="space-y-2">
              {classes.slice(0, 5).map((c) => (
                <Link key={c.id} to={`/classes/${c.id}`} className="block rounded-lg border p-3 transition-colors hover:bg-accent">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{c.name}</p>
                    <span className="text-xs text-muted-foreground">{c.academicYear}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.teacher ? `Teacher: ${c.teacher.name}` : 'No teacher assigned'} · {c._count?.enrollments ?? 0} students
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Courses</h2>
          {coursesLoading ? (
            <Skeleton className="h-40" />
          ) : coursesError ? (
            <ErrorState onRetry={refetchCourses} />
          ) : courses.length === 0 ? (
            <EmptyState icon={BookOpen} title="No courses yet" description="Teachers can author the first course." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {courses.slice(0, 4).map((c, i) => (
                <CourseCard key={c.id} course={c} delay={i * 0.04} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── TEACHER ────────────────────────────────────────────────────────────────

export function TeacherPanel() {
  const { data: courses = [], isLoading, error, refetch } = useCourses();
  const published = courses.filter((c) => c.status === 'PUBLISHED').length;
  const drafts = courses.filter((c) => c.status === 'DRAFT').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My teaching"
        description="Build courses and keep an eye on learner progress."
      >
        <Button asChild size="sm">
          <Link to="/courses">View courses</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={BookOpen} label="Total courses" value={isLoading || error ? '…' : courses.length} delay={0} />
        <StatCard icon={FileCheck2} label="Published" value={isLoading || error ? '…' : published} delay={0.05} />
        <StatCard icon={PlayCircle} label="Drafts" value={isLoading || error ? '…' : drafts} delay={0.1} />
        <StatCard icon={Award} label="Assignments" value={isLoading || error ? '…' : courses.reduce((sum, c) => sum + (c._count?.assignments ?? 0), 0)} delay={0.15} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Your courses</h2>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        ) : error ? (
          <ErrorState onRetry={refetch} />
        ) : courses.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No courses yet"
            description="Create your first course from the course library."
            action={
              <Button asChild size="sm">
                <Link to="/courses">Start authoring</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c, i) => <CourseCard key={c.id} course={c} delay={i * 0.04} />)}
          </div>
        )}
      </section>
    </div>
  );
}

// ── STUDENT ────────────────────────────────────────────────────────────────

export function StudentPanel() {
  const { data: courses = [], isLoading, error, refetch } = useCourses();
  const published = courses.filter((c) => c.status === 'PUBLISHED');
  const assignmentsCount = courses.reduce((sum, c) => sum + (c._count?.assignments ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My learning"
        description="Pick up where you left off, or start something new."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard icon={BookOpen} label="Courses available" value={isLoading || error ? '…' : courses.length} delay={0} />
        <StatCard icon={FileCheck2} label="Assignments" value={isLoading || error ? '…' : assignmentsCount} delay={0.05} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Available courses</h2>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        ) : error ? (
          <ErrorState onRetry={refetch} />
        ) : published.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Nothing published yet"
            description="Your teachers haven't published a course to your class yet. Check back soon."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {published.map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: i * 0.04 }}>
                <Link to={`/courses/${c.id}/learn`} className="block group">
                  <Card className={cn('h-full transition-shadow hover:shadow-md')}>
                    <CardContent className="flex h-full flex-col gap-3 p-5">
                      <Badge variant={statusTone[c.status]}>{c.status}</Badge>
                      <h3 className="font-semibold leading-snug group-hover:text-primary">{c.title}</h3>
                      <p className="mt-auto line-clamp-2 text-sm text-muted-foreground">
                        {c.description ?? 'No description yet.'}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}