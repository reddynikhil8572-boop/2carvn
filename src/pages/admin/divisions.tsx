import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Building2, Plus, UserRoundCog } from 'lucide-react';

import { useSchools } from '@/hooks/useSchools';
import {
  useCoordinators,
  useCreateCoordinator,
  useCreateDivision,
  useDivisions,
  useGrantCoordinatorDivision,
  useRevokeCoordinatorDivision,
  useSetSchoolDivision,
} from '@/hooks/useDivisions';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export function AdminDivisionsPage() {
  const divisionsQuery = useDivisions();
  const coordinatorsQuery = useCoordinators();
  const schoolsQuery = useSchools();
  const createDivision = useCreateDivision();
  const createCoordinator = useCreateCoordinator();
  const grantCoordinator = useGrantCoordinatorDivision();
  const revokeCoordinatorMutation = useRevokeCoordinatorDivision();
  const setSchoolDivision = useSetSchoolDivision();
  const [divisionCode, setDivisionCode] = useState('');
  const [divisionName, setDivisionName] = useState('');
  const [divisionRegion, setDivisionRegion] = useState('');
  const [coordinatorName, setCoordinatorName] = useState('');
  const [coordinatorEmail, setCoordinatorEmail] = useState('');
  const [coordinatorSchoolId, setCoordinatorSchoolId] = useState('');
  const [selectedCoordinatorId, setSelectedCoordinatorId] = useState('');
  const divisions = divisionsQuery.data ?? [];
  const coordinators = coordinatorsQuery.data ?? [];
  const schools = schoolsQuery.data ?? [];
  const schoolDivision = useMemo(
    () => new Map(divisions.flatMap((division) => division.schools.map((school) => [school.id, division.id] as const))),
    [divisions],
  );

  async function submitDivision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createDivision.mutateAsync({
        code: divisionCode,
        name: divisionName,
        ...(divisionRegion.trim() ? { region: divisionRegion.trim() } : {}),
      });
      setDivisionCode('');
      setDivisionName('');
      setDivisionRegion('');
      toast.success('Division created');
    } catch {
      toast.error('Could not create division. Check the code and try again.');
    }
  }

  async function submitCoordinator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const coordinator = await createCoordinator.mutateAsync({
        schoolId: coordinatorSchoolId,
        name: coordinatorName.trim(),
        email: coordinatorEmail.trim(),
      });
      setSelectedCoordinatorId(coordinator.id);
      setCoordinatorName('');
      setCoordinatorEmail('');
      toast.success('Coordinator account created; password setup instructions were requested.');
    } catch {
      toast.error('Could not create coordinator. Verify the school and email address.');
    }
  }

  async function assignCoordinator(divisionId: string) {
    if (!selectedCoordinatorId) {
      toast.error('Select or create a coordinator first.');
      return;
    }
    try {
      await grantCoordinator.mutateAsync({ divisionId, coordinatorId: selectedCoordinatorId });
      toast.success('Coordinator assigned to division');
    } catch {
      toast.error('Could not assign coordinator to this division.');
    }
  }

  async function changeSchoolDivision(schoolId: string, divisionId: string) {
    try {
      await setSchoolDivision.mutateAsync({
        schoolId,
        divisionId: divisionId === 'unassigned' ? null : divisionId,
      });
      toast.success('School division updated');
    } catch {
      toast.error('Could not update school division.');
    }
  }

  async function revokeCoordinator(divisionId: string, coordinatorId: string) {
    try {
      await revokeCoordinatorMutation.mutateAsync({ divisionId, coordinatorId });
      toast.success('Coordinator division access revoked');
    } catch {
      toast.error('Could not revoke coordinator access.');
    }
  }

  const loadError = divisionsQuery.error || coordinatorsQuery.error || schoolsQuery.error;
  const refetch = () => {
    void divisionsQuery.refetch();
    void coordinatorsQuery.refetch();
    void schoolsQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Divisions and coordinators"
        description="Organise schools into divisions and grant coordinators only the operational scope they need."
      />

      {loadError ? <ErrorState onRetry={refetch} /> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Plus className="h-4 w-4" aria-hidden /> Create division</CardTitle>
            <CardDescription>Division codes must be unique.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-3" onSubmit={(event) => void submitDivision(event)}>
              <div className="grid gap-2">
                <Label htmlFor="division-code">Code</Label>
                <Input id="division-code" value={divisionCode} onChange={(event) => setDivisionCode(event.target.value)} maxLength={32} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="division-name">Name</Label>
                <Input id="division-name" value={divisionName} onChange={(event) => setDivisionName(event.target.value)} maxLength={160} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="division-region">Region (optional)</Label>
                <Input id="division-region" value={divisionRegion} onChange={(event) => setDivisionRegion(event.target.value)} maxLength={120} />
              </div>
              <Button type="submit" className="sm:col-span-3" disabled={createDivision.isPending}>
                {createDivision.isPending ? 'Creating…' : 'Create division'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><UserRoundCog className="h-4 w-4" aria-hidden /> Create coordinator account</CardTitle>
            <CardDescription>The account is school-bound for sign-in; access to other schools comes only from division grants.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-3" onSubmit={(event) => void submitCoordinator(event)}>
              <div className="grid gap-2">
                <Label htmlFor="coordinator-school">Sign-in school</Label>
                <select id="coordinator-school" className="h-10 rounded-md border bg-background px-3 text-sm" value={coordinatorSchoolId} onChange={(event) => setCoordinatorSchoolId(event.target.value)} required>
                  <option value="">Select a school</option>
                  {schools.filter((school) => school.isActive).map((school) => (
                    <option key={school.id} value={school.id}>{school.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="coordinator-name">Name</Label>
                <Input id="coordinator-name" value={coordinatorName} onChange={(event) => setCoordinatorName(event.target.value)} maxLength={120} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="coordinator-email">Email</Label>
                <Input id="coordinator-email" type="email" value={coordinatorEmail} onChange={(event) => setCoordinatorEmail(event.target.value)} required />
              </div>
              <Button type="submit" className="sm:col-span-3" disabled={createCoordinator.isPending || schools.length === 0}>
                {createCoordinator.isPending ? 'Creating…' : 'Create coordinator'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Division assignments</h2>
            <p className="text-sm text-muted-foreground">School and coordinator access changes are restricted to Admin.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="division-coordinator">Coordinator to assign</Label>
            <select id="division-coordinator" className="h-10 min-w-64 rounded-md border bg-background px-3 text-sm" value={selectedCoordinatorId} onChange={(event) => setSelectedCoordinatorId(event.target.value)}>
              <option value="">Select coordinator</option>
              {coordinators.filter((coordinator) => coordinator.status === 'ACTIVE').map((coordinator) => (
                <option key={coordinator.id} value={coordinator.id}>
                  {coordinator.name} · {coordinator.email}
                </option>
              ))}
            </select>
          </div>
        </div>

        {divisionsQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((index) => <Skeleton key={index} className="h-52" />)}</div>
        ) : divisions.length === 0 ? (
          <EmptyState icon={Building2} title="No divisions created" description="Create a division to begin assigning schools and coordinators." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {divisions.map((division) => (
              <Card key={division.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{division.name}</CardTitle>
                      <CardDescription>{division.code}{division.region ? ` · ${division.region}` : ''}</CardDescription>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => void assignCoordinator(division.id)} disabled={grantCoordinator.isPending}>
                      Assign coordinator
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor={`school-${division.id}`}>Assign a school</Label>
                    <select
                      id={`school-${division.id}`}
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value=""
                      onChange={(event) => {
                        if (event.target.value) void changeSchoolDivision(event.target.value, division.id);
                      }}
                      disabled={setSchoolDivision.isPending}
                    >
                      <option value="">Choose school</option>
                      {schools.filter((school) => schoolDivision.get(school.id) !== division.id).map((school) => (
                        <option key={school.id} value={school.id}>{school.name} · {school.schoolCode}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-sm font-medium">Schools ({division.schools.length})</p>
                    {division.schools.length ? division.schools.map((school) => (
                      <div key={school.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>{school.name} · {school.schoolCode}</span>
                        <select
                          aria-label={`Division for ${school.name}`}
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={division.id}
                          onChange={(event) => void changeSchoolDivision(school.id, event.target.value)}
                        >
                          {divisions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                          <option value="unassigned">Unassigned</option>
                        </select>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">No schools assigned.</p>}
                  </div>
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-sm font-medium">Coordinator grant history</p>
                    {division.coordinators.length ? division.coordinators.map((grant) => (
                      <div key={grant.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>{grant.coordinator.name} · {grant.coordinator.email}</span>
                        {grant.revokedAt ? (
                          <Badge variant="secondary">Revoked</Badge>
                        ) : (
                          <Button type="button" size="sm" variant="ghost" onClick={() => void revokeCoordinator(division.id, grant.coordinator.id)} disabled={revokeCoordinatorMutation.isPending}>
                            Revoke access
                          </Button>
                        )}
                      </div>
                    )) : <p className="text-sm text-muted-foreground">No coordinator grants.</p>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
