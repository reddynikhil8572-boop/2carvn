import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { useCreateSchool, useSchools } from '@/hooks/useSchools';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Plan } from '@/types/api';

const plans: Plan[] = ['BASIC', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'];

const createSchema = z.object({
  schoolCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,32}$/, 'Use 3–32 uppercase letters, numbers or dashes'),
  name: z.string().trim().min(2, 'Name is required').max(160),
  city: z.string().trim().max(120).optional(),
  plan: z.enum(['BASIC', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE']),
  primaryColor: z
    .union([
      z.literal(''),
      z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Enter a hex colour like #0F766E'),
    ])
    .optional(),
  admin: z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    name: z.string().trim().min(2, 'Name is required'),
    password: z.string().optional(),
  }),
});

type CreateValues = z.infer<typeof createSchema>;

const columnHeadings = ['School code', 'Name', 'City', 'Plan', 'Status', 'Users'];

export function SuperAdminSchoolsPage() {
  const { data: schools = [], isLoading, error, refetch } = useSchools();
  const createSchool = useCreateSchool();

  const [createOpen, setCreateOpen] = useState(false);

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      schoolCode: '',
      name: '',
      city: '',
      plan: 'STANDARD',
      primaryColor: '',
      admin: { email: '', name: '', password: '' },
    },
  });

  async function handleCreate(values: CreateValues) {
    try {
      await createSchool.mutateAsync({
        ...values,
        // Empty form values should not travel as "" — the backend accepts an
        // absent field, not an empty string. Same treatment as admin.password.
        primaryColor: values.primaryColor || undefined,
        admin: { ...values.admin, password: values.admin.password || undefined },
      });
      toast.success('School created');
      setCreateOpen(false);
      createForm.reset();
    } catch {
      /* global mutation toast covers the failure */
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Schools" description="All tenants on the platform.">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1" aria-hidden /> New school
        </Button>
      </PageHeader>

      {isLoading ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                {columnHeadings.map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : error ? (
        <ErrorState onRetry={refetch} />
      ) : schools.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No schools yet"
          description="Schools appear here once they're created."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                {columnHeadings.map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {schools.map((school) => (
                <TableRow key={school.id}>
                  <TableCell>
                    <Badge variant="outline">{school.schoolCode}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{school.name}</TableCell>
                  <TableCell>{school.city ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{school.plan}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={school.isActive ? 'success' : 'warning'}>
                      {school.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>{school.userCount ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New school</DialogTitle>
            <DialogDescription>
              Create a new tenant and its first administrator.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4" noValidate>
              <FormField
                control={createForm.control}
                name="schoolCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>School code</FormLabel>
                    <FormControl>
                      <Input autoCapitalize="characters" placeholder="e.g. WESTHILL" {...field} />
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
                      <Input placeholder="e.g. Westhill High School" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Nairobi" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="plan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plan</FormLabel>
                    <Select value={field.value} onValueChange={(value) => field.onChange(value as Plan)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {plans.map((plan) => (
                          <SelectItem key={plan} value={plan}>{plan}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="primaryColor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary colour</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span
                          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-border"
                          style={{ backgroundColor: field.value || 'transparent' }}
                          aria-hidden
                        />
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder="#0F766E"
                          className="pl-9"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="admin.email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="admin@school.edu" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="admin.name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Ada Lovelace" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="admin.password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin password (optional)</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Leave blank to email a set-password link" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createSchool.isPending}>
                  {createSchool.isPending ? 'Creating…' : 'Create school'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}