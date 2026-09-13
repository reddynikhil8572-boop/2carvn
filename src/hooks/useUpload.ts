import { useQuery } from '@tanstack/react-query';

import * as uploadsApi from '@/api/upload';

/** Query keys for object-storage-backed resources. */
export const uploadKeys = {
  cover: (courseId: string) => ['courses', 'cover', courseId] as const,
};

/**
 * Signed URL for a course cover, or null when none is set. Staff and students
 * both read it; uploads happen in the course editor.
 */
export function useCoverUrl(courseId: string) {
  return useQuery({
    queryKey: uploadKeys.cover(courseId),
    queryFn: () => uploadsApi.getCoverUrl(courseId),
    enabled: courseId.length > 0,
    staleTime: 60_000,
  });
}