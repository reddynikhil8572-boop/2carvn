import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as classesApi from '@/api/classes';

export const classKeys = {
  all: ['classes'] as const,
  detail: (id: string) => ['classes', id] as const,
  enrollments: (id: string) => ['classes', id, 'enrollments'] as const,
};

export function useClasses() {
  return useQuery({
    queryKey: classKeys.all,
    queryFn: classesApi.listClasses,
  });
}

export function useCreateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: classesApi.createClass,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: classKeys.all }),
  });
}

export function useEnrollments(classId: string) {
  return useQuery({
    queryKey: classKeys.enrollments(classId),
    queryFn: () => classesApi.listEnrollments(classId),
  });
}

export function useEnrolStudent(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) => classesApi.enrolStudent(classId, studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: classKeys.enrollments(classId) });
      queryClient.invalidateQueries({ queryKey: classKeys.all });
    },
  });
}