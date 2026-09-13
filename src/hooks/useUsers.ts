import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as usersApi from '@/api/users';

export const userKeys = {
  all: ['users'] as const,
};

export function useUsers() {
  return useQuery({
    queryKey: userKeys.all,
    queryFn: usersApi.listUsers,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: usersApi.createUser,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useExportUserData() {
  return useMutation({ mutationFn: usersApi.exportUserData });
}

export function useEraseUser(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: usersApi.EraseUserPayload) => usersApi.eraseUserData(userId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}