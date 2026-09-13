import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Plus, Users } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthUser } from '@/stores/auth';
import { useCreateUser, useUsers } from '@/hooks/useUsers';
import { isSchoolAdmin, roleLabel } from '@/lib/utils';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { UserStatus } from '@/types/api';

/** Roles a school admin may create — mirrors CREATABLE_ROLES, minus SUPER_ADMIN. */
const CREATABLE_ROLES = ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT'] as const;

const statusTone: Record<UserStatus, 'secondary' | 'success' | 'warning'> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  SUSPENDED: 'warning',
};

const createSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name must be 200 characters or fewer'),
  role: z.enum(CREATABLE_ROLES),
  password: z.string().trim().optional(),
});

type CreateValues = z.infer<typeof createSchema>;

export function UsersPage() {
  const user = useAuthUser();
  const navigate = useNavigate();
  const isAdmin = isSchoolAdmin(user?.role ?? 'STUDENT');

  const { data: users = [], isLoading, error, refetch } = useUsers();
  const createUser = useCreateUser();

  const [createOpen, setCreateOpen] = useState(false);

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: '', name: '', role: 'STUDENT', password: '' },
  });

  async function handleCreate(values: CreateValues) {
    try {
      await createUser.mutateAsync({
        email: values.email,
        name: values.name,
        role: values.role,
        password: values.password || undefined,
      });
      toast.success('User created');
      setCreateOpen(false);
      createForm.reset();
    } catch {
      /* global mutation toast covers the failure */
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage the people in your school — create accounts and review sign-in activity."
      >
        {isAdmin ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1" aria-hidden /> Create user
          </Button>
        ) : null}
      </PageHeader>

      {isLoading ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[0, 1, 2, 3, 4].map((i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-52" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : error ? (
        <ErrorState onRetry={refetch} />
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users yet"
          description="Create the first account to start adding people to your school."
          action={
            isAdmin ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1" aria-hidden /> Create user
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((person) => (
                <TableRow
                  key={person.id}
                  onClick={() => navigate(`/users/${person.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/users/${person.id}`);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Open user ${person.name}`}
                  className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
                >
                  <TableCell className="font-medium">{person.name}</TableCell>
                  <TableCell className="text-muted-foreground">{person.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{roleLabel(person.role)}</Badge>
                  </TableCell>
                  <TableCell>
                    {person.erasedAt ? (
                      <Badge variant="outline">Erased</Badge>
                    ) : (
                      <Badge variant={statusTone[person.status]}>{person.status}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {person.lastLoginAt ? format(new Date(person.lastLoginAt), 'PP') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>Add a new member to your school.</DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4" noValidate>
              <FormField
                control={createForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="john@school.edu" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane Doe" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CREATABLE_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {roleLabel(role)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Optional — leave blank for a set-password email"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Optional. Leave blank to email the user a link to set their own password.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createUser.isPending}>
                  {createUser.isPending ? 'Creating…' : 'Create user'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}