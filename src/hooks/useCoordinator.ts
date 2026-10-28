import { useQuery } from '@tanstack/react-query';
import { getCoordinatorWorkspace } from '@/api/coordinator';

export function useCoordinatorWorkspace(enabled = true) {
  return useQuery({
    queryKey: ['coordinator', 'divisions'],
    queryFn: getCoordinatorWorkspace,
    enabled,
  });
}
