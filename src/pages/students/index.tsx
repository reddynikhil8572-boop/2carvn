import { useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { GraduationCap, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthUser } from '@/stores/auth';
import { useCreateUser, useUsers } from '@/hooks/useUsers';
import { useClasses, useEnrolStudent } from '@/hooks/useClasses';
import { isSchoolAdmin } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name must be 200 characters or fewer'),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().trim().optional(),
  classId: z.string().uuid('Select a class'),
});

type CreateValues = z.infer<typeof createSchema>;

export function StudentsPage() {
  const user = useAuthUser();
  const isAdmin = isSchoolAdmin(user?.role ?? 'STUDENT');
  const { data: classes = [], isLoading: classesLoading, error: classesError, refetch } = useClasses();
  const { data: users = [] } = useUsers();
  const createUser = useCreateUser();
  const [selectedClassId, setSelectedClassId] = useState('');
  const enrolStudent = useEnrolStudent(selectedClassId);

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', email: '', password: '', classId: '' },
  });

  const students = users.filter((person) => person.role === 'STUDENT');

  async function handleCreate(values: CreateValues) {
    try {
      const created = await createUser.mutateAsync({
        name: values.name,
        email: values.email,
        role: 'STUDENT',
        password: values.password || undefined,
      });
      await enrolStudent.mutateAsync(created.id);
      toast.success(
        created.mustSetPassword
          ? `${values.name} was added. A password setup link was sent to ${values.email}.`
          : `${values.name} was added to the class`,
      );
      form.reset();
      setSelectedClassId('');
    } catch {
      /* global mutation toast covers the failure */
    }
  }

  if (!isAdmin) {
    return <ErrorState title="School admin access required" description="Only school admins can create students and assign classes." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Create student accounts and place each student in the right class from one screen."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden /> New student</CardTitle>
            <CardDescription>The student will receive a link to set their password.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4" noValidate>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full name</FormLabel>
                      <FormControl><Input placeholder="Jane Doe" autoComplete="off" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" placeholder="jane@school.edu" autoComplete="off" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                      <FormControl><Input type="password" placeholder="Leave blank to email a setup link" autoComplete="new-password" {...field} /></FormControl>
                      <FormDescription>If blank, the student sets their own password from the email link.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="classId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Class</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value);
                          setSelectedClassId(value);
                        }}
                        disabled={classes.length === 0}
                      >
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {classes.map((classItem) => (
                            <SelectItem key={classItem.id} value={classItem.id}>
                              {classItem.name} · {classItem.academicYear}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Students can be placed in another class later from the class roster.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createUser.isPending || enrolStudent.isPending || classes.length === 0}>
                  <Plus aria-hidden /> {createUser.isPending || enrolStudent.isPending ? 'Creating student...' : 'Create student'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><GraduationCap className="h-4 w-4" aria-hidden /> Classes</CardTitle>
            <CardDescription>Choose a class in the form to add its next student.</CardDescription>
          </CardHeader>
          <CardContent>
            {classesLoading ? (
              <div className="space-y-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-14" />)}</div>
            ) : classesError ? (
              <ErrorState onRetry={refetch} />
            ) : classes.length === 0 ? (
              <EmptyState icon={GraduationCap} title="Create a class first" description="Students must belong to a class when they are created." />
            ) : (
              <div className="space-y-2">
                {classes.map((classItem) => (
                  <div key={classItem.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium">{classItem.name}</p>
                      <p className="text-xs text-muted-foreground">{classItem.academicYear}</p>
                    </div>
                    <Badge variant="secondary"><Users className="mr-1 h-3 w-3" aria-hidden /> {classItem._count?.enrollments ?? 0} students</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-sm text-muted-foreground">{students.length} student accounts in your school.</p>
    </div>
  );
}
