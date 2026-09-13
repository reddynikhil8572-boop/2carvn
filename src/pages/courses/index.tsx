import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BookOpen, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthUser } from '@/stores/auth';
import { useCourses, useCreateCourse } from '@/hooks/useCourses';
import { isStaff } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CourseSummary } from '@/types/models';
import type { CourseStatus } from '@/types/api';

const statusTone: Record<CourseStatus, 'secondary' | 'success' | 'warning'> = {
  DRAFT: 'secondary',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  subject: z.string().trim().max(100).optional(),
  description: z.string().trim().max(5000).optional(),
});

type CreateValues = z.infer<typeof createSchema>;

function CourseItem({ course }: { course: CourseSummary }) {
  return (
    <Link to={`/courses/${course.id}`} className="group block">
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <Badge variant={statusTone[course.status]}>{course.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {course._count?.modules ?? 0} modules
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold leading-snug group-hover:text-primary">{course.title}</h3>
            {course.subject ? <p className="mt-1 text-sm text-muted-foreground">{course.subject}</p> : null}
          </div>
          <p className="mt-auto line-clamp-2 text-sm text-muted-foreground">
            {course.description ?? 'No description yet.'}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

export function CoursesPage() {
  const user = useAuthUser();
  const staff = user ? isStaff(user.role) : false;
  const navigate = useNavigate();

  const { data: courses = [], isLoading, error, refetch } = useCourses();
  const createCourse = useCreateCourse();

  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<'ALL' | CourseStatus>('ALL');

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { title: '', subject: '', description: '' },
  });

  const filtered = filter === 'ALL' ? courses : courses.filter((c) => c.status === filter);

  async function handleCreate(values: CreateValues) {
    try {
      const created = await createCourse.mutateAsync(values);
      toast.success('Course created');
      setCreateOpen(false);
      createForm.reset();
      navigate(`/courses/${created.id}/edit`);
    } catch {
      /* global mutation toast covers the failure */
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={staff ? 'Courses' : 'My courses'}
        description={
          staff
            ? 'Author, publish and manage your course catalogue.'
            : 'Courses assigned to your class.'
        }
      >
        {staff ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1" aria-hidden /> New course
          </Button>
        ) : null}
      </PageHeader>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          <TabsTrigger value="ALL">All</TabsTrigger>
          <TabsTrigger value="DRAFT">Draft</TabsTrigger>
          <TabsTrigger value="PUBLISHED">Published</TabsTrigger>
          <TabsTrigger value="ARCHIVED">Archived</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : error ? (
        <ErrorState onRetry={refetch} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={filter === 'ALL' ? 'No courses yet' : `No ${filter.toLowerCase()} courses`}
          description={
            staff
              ? 'Create the first course and start building its structure.'
              : 'Courses assigned to your class will appear here.'
          }
          action={
            staff ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1" aria-hidden /> New course
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3')}>
          {filtered.map((course) => <CourseItem key={course.id} course={course} />)}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New course</DialogTitle>
            <DialogDescription>You'll be taken to the editor to structure it next.</DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4" noValidate>
              <FormField
                control={createForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Biology 101" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Science" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea rows={3} placeholder="What will learners get from this course?" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createCourse.isPending}>
                  {createCourse.isPending ? 'Creating…' : 'Create course'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}