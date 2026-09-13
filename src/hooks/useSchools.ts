import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as schoolsApi from '@/api/schools';

export const schoolKeys = {
  all: ['schools'] as const,
};

export function useSchools() {
  return useQuery({
    queryKey: schoolKeys.all,
    queryFn: schoolsApi.listSchools,
  });
}

export function useCreateSchool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: schoolsApi.createSchool,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: schoolKeys.all }),
  });
}