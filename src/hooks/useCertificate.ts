import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as certApi from '@/api/certificates';

export const certificateKeys = {
  list: (courseId: string) => ['certificates', courseId] as const,
  verify: (serial: string) => ['certificates', 'verify', serial] as const,
};

export function useCertificates(courseId: string) {
  return useQuery({
    queryKey: certificateKeys.list(courseId),
    queryFn: () => certApi.listCertificates(courseId),
  });
}

export function useIssueCertificate(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) => certApi.issueCertificate(courseId, studentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: certificateKeys.list(courseId) }),
  });
}

export function useRevokeCertificate(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { serial: string; reason?: string }) =>
      certApi.revokeCertificate(args.serial, args.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: certificateKeys.list(courseId) }),
  });
}

export function useVerifyCertificate(serial: string) {
  return useQuery({
    queryKey: certificateKeys.verify(serial),
    queryFn: () => certApi.verifyCertificate(serial),
    enabled: serial.length > 0,
  });
}