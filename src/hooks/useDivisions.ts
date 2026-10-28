import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as divisionsApi from '@/api/divisions';
import { schoolKeys } from '@/hooks/useSchools';

export const divisionKeys = {
  all: ['admin-divisions'] as const,
  coordinators: ['admin-coordinators'] as const,
};

export function useDivisions() {
  return useQuery({ queryKey: divisionKeys.all, queryFn: divisionsApi.listDivisions });
}

export function useCoordinators() {
  return useQuery({ queryKey: divisionKeys.coordinators, queryFn: divisionsApi.listCoordinators });
}

export function useCreateDivision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: divisionsApi.createDivision,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: divisionKeys.all }),
  });
}

export function useCreateCoordinator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: divisionsApi.createCoordinator,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: divisionKeys.coordinators }),
  });
}

export function useGrantCoordinatorDivision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ divisionId, coordinatorId }: { divisionId: string; coordinatorId: string }) =>
      divisionsApi.grantCoordinatorDivision(divisionId, coordinatorId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: divisionKeys.all }),
  });
}

export function useRevokeCoordinatorDivision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ divisionId, coordinatorId }: { divisionId: string; coordinatorId: string }) =>
      divisionsApi.revokeCoordinatorDivision(divisionId, coordinatorId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: divisionKeys.all }),
  });
}

export function useSetSchoolDivision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ schoolId, divisionId }: { schoolId: string; divisionId: string | null }) =>
      divisionsApi.setSchoolDivision(schoolId, divisionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: divisionKeys.all });
      void queryClient.invalidateQueries({ queryKey: schoolKeys.all });
    },
  });
}
