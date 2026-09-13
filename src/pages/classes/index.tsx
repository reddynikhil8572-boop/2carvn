import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { GraduationCap, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthUser } from '@/stores/auth';
import { useClasses, useCreateClass } from '@/hooks/useClasses';
import { useUsers } from '@/hooks/useUsers';
import { isSchoolAdmin } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  academicYear: z.string().trim().min(1, 'Academic year is required').max(9),
  teacherId: z.union([z.string().uuid('Select a valid teacher'), z.literal('')]),
});

type CreateValues = z.infer<typeof createSchema>;

export function ClassesPage() {
  const user = useAuthUser();
  const navigate = useNavigate();
  const isAdmin = user ? isSchoolAdmin(user.role) : false;

  const { data: classes = [], isLoading, error, refetch } = useClasses();
  const { data: users = [] } = useUsers();
  const createClass = useCreateClass();

  const [createOpen, setCreateOpen] = useState(false);

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', academicYear: '', teacherId: '' },
  });

  const teachers = users.filter((u) => u.role === 'TEACHER');

  async function handleCreate(values: CreateValues) {
    try {
      await createClass.mutateAsync({
        name: values.name,
        academicYear: values.academicYear,
        ...(values.teacherId ? { teacherId: values.teacherId } : {}),
      });
      toast.success('Class created');
      setCreateOpen(false);
      createForm.reset();
    } catch {
      /* global mutation toast covers the failure */
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Classes"
        description="Manage your classes and the students enrolled in each one."
      >
        {isAdmin ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1" aria-hidden /> New class
          </Button>
        ) : null}
      </PageHeader>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : error ? (
        <ErrorState onRetry={refetch} />
      ) : classes.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No classes yet"
          description={
            isAdmin
              ? 'Create your first class and start enrolling students.'
              : 'Classes created by your school will appear here.'
          }
          action={
            isAdmin ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1" aria-hidden /> New class
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Academic year</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead className="text-right">Students</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((cls) => (
                <TableRow
                  key={cls.id}
                  className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
                  onClick={() => navigate(`/classes/${cls.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/classes/${cls.id}`);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Open class ${cls.name}`}
                >
                  <TableCell className="font-medium">{cls.name}</TableCell>
                  <TableCell>{cls.academicYear}</TableCell>
                  <TableCell>{cls.teacher?.name ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{cls._count?.enrollments ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New class</DialogTitle>
            <DialogDescription>
              Give the class a name and academic year. You can assign a teacher at any time.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4" noValidate>
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Biology 101" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="academicYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Academic year</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 2025–2026" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="teacherId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teacher</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="No teacher assigned" />
                        </SelectTrigger>
                        <SelectContent>
                          {teachers.length > 0 ? (
                            teachers.map((teacher) => (
                              <SelectItem key={teacher.id} value={teacher.id}>
                                {teacher.name}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="~" disabled>
                              No teachers available
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>Optional. Assign a teacher to this class.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createClass.isPending}>
                  {createClass.isPending ? 'Creating…' : 'Create class'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}