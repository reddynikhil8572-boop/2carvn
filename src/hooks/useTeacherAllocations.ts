import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as allocationApi from '@/api/teacher-allocations';
import type { UserRole } from '@/types/api';

export const allocationKeys = {
  all: ['teacher-allocations'] as const,
  workspace: (role: UserRole, schoolId?: string) =>
    ['teacher-allocations', 'workspace', role, schoolId ?? 'self'] as const,
};

export function useAllocationWorkspace(role: UserRole, schoolId: string) {
  return useQuery({
    queryKey: allocationKeys.workspace(role, schoolId),
    queryFn: () => role === 'ADMIN'
      ? allocationApi.getAllocationWorkspace(schoolId)
      : allocationApi.getSchoolAllocationWorkspace(),
    enabled: role === 'ORGANISER' || (role === 'ADMIN' && Boolean(schoolId)),
  });
}

export function useMyAllocations(enabled = true) {
  return useQuery({
    queryKey: allocationKeys.workspace('TEACHER'),
    queryFn: allocationApi.getMyAllocations,
    enabled,
  });
}

const invalidateAllocationQueries = (queryClient: ReturnType<typeof useQueryClient>) =>
  () => queryClient.invalidateQueries({ queryKey: allocationKeys.all });

export function useCreateAllocation(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: allocationApi.AllocationPayload) =>
      allocationApi.createAllocation(schoolId, payload),
    onSuccess: invalidateAllocationQueries(queryClient),
  });
}

export function useSubmitAllocationRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: allocationApi.submitAllocationRequest,
    onSuccess: invalidateAllocationQueries(queryClient),
  });
}

export function useDecideAllocationRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, decision }: { requestId: string; decision: 'APPROVED' | 'REJECTED' }) =>
      allocationApi.decideAllocationRequest(requestId, decision),
    onSuccess: invalidateAllocationQueries(queryClient),
  });
}

export function useAddTimetableSlot(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      allocationId,
      payload,
    }: {
      allocationId: string;
      payload: allocationApi.TimetablePayload;
    }) => allocationApi.addTimetableSlot(schoolId, allocationId, payload),
    onSuccess: invalidateAllocationQueries(queryClient),
  });
}

export function useRemoveTimetableSlot(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ allocationId, slotId }: { allocationId: string; slotId: string }) =>
      allocationApi.removeTimetableSlot(schoolId, allocationId, slotId),
    onSuccess: invalidateAllocationQueries(queryClient),
  });
}

export function useSetTeacherAvailability(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      teacherId,
      availability,
    }: {
      teacherId: string;
      availability: allocationApi.AvailabilityWindow[];
    }) => allocationApi.setTeacherAvailability(schoolId, teacherId, availability),
    onSuccess: invalidateAllocationQueries(queryClient),
  });
}

export function useSetMyAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: allocationApi.setMyAvailability,
    onSuccess: invalidateAllocationQueries(queryClient),
  });
}
