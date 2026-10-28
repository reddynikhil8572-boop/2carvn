import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as schoolsApi from '@/api/schools';

export const schoolKeys = {
  all: ['schools'] as const,
};

export function useSchools(enabled = true) {
  return useQuery({
    queryKey: schoolKeys.all,
    queryFn: schoolsApi.listSchools,
    enabled,
  });
}

export function useCreateSchool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: schoolsApi.createSchool,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: schoolKeys.all }),
  });
}