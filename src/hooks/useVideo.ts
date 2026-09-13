import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as videoApi from '@/api/video';

export const videoKeys = {
  url: (itemId: string) => ['video', itemId, 'url'] as const,
  progress: (itemId: string) => ['video', itemId, 'progress'] as const,
  allProgress: (itemId: string) => ['video', itemId, 'progress', 'all'] as const,
  analytics: (courseId: string) => ['video', courseId, 'analytics'] as const,
};

export function useVideoUrl(itemId: string) {
  return useQuery({
    queryKey: videoKeys.url(itemId),
    queryFn: () => videoApi.getVideoUrl(itemId),
    staleTime: 5 * 60_000,
  });
}

export function useOwnProgress(itemId: string) {
  return useQuery({
    queryKey: videoKeys.progress(itemId),
    queryFn: () => videoApi.getOwnProgress(itemId),
  });
}

/** Fire a heartbeat; the backend clamps credited time to real elapsed time. */
export function useRecordHeartbeat(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: videoApi.HeartbeatPayload) =>
      videoApi.recordHeartbeat(itemId, payload),
    onSuccess: (progress) => {
      queryClient.setQueryData(videoKeys.progress(itemId), progress);
    },
  });
}

export function useAllProgress(itemId: string) {
  return useQuery({
    queryKey: videoKeys.allProgress(itemId),
    queryFn: () => videoApi.listProgressForItem(itemId),
  });
}

export function useCourseVideoAnalytics(courseId: string) {
  return useQuery({
    queryKey: videoKeys.analytics(courseId),
    queryFn: () => videoApi.getCourseVideoAnalytics(courseId),
  });
}