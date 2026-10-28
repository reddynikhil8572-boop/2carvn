import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listEnquiries, updateEnquiryStatus, type EnquiryStatus } from '@/api/enquiries';

export function useEnquiries() {
  return useQuery({ queryKey: ['admin', 'enquiries'], queryFn: listEnquiries });
}

export function useUpdateEnquiryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: EnquiryStatus }) => updateEnquiryStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'enquiries'] }),
  });
}
