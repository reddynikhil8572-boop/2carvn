import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as coursesApi from '@/api/courses';

export const courseKeys = {
  all: ['courses'] as const,
  detail: (id: string) => ['courses', id] as const,
};

export function useCourses() {
  return useQuery({
    queryKey: courseKeys.all,
    queryFn: coursesApi.listCourses,
  });
}

export function useCourse(id: string) {
  return useQuery({
    queryKey: courseKeys.detail(id),
    queryFn: () => coursesApi.getCourse(id),
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function useCreateCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: coursesApi.createCourse,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: courseKeys.all }),
  });
}

export function useUpdateCourse(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: coursesApi.UpdateCoursePayload) => coursesApi.updateCourse(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: courseKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: courseKeys.all });
    },
  });
}

export function useCreateModule(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: coursesApi.CreateModulePayload) => coursesApi.createModule(courseId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: courseKeys.detail(courseId) }),
  });
}

export function useCreateChapter(moduleId: string, courseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: coursesApi.CreateChapterPayload) => coursesApi.createChapter(moduleId, payload),
    onSuccess: () => invalidateCourseTree(queryClient, courseId),
  });
}

export function useCreateLesson(chapterId: string, courseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: coursesApi.CreateLessonPayload) => coursesApi.createLesson(chapterId, payload),
    onSuccess: () => invalidateCourseTree(queryClient, courseId),
  });
}

export function useCreateLessonItem(lessonId: string, courseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: coursesApi.CreateLessonItemPayload) =>
      coursesApi.createLessonItem(lessonId, payload),
    onSuccess: () => invalidateCourseTree(queryClient, courseId),
  });
}

export function useUpdateLessonItem(itemId: string, courseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: coursesApi.UpdateLessonItemPayload) =>
      coursesApi.updateLessonItem(itemId, payload),
    onSuccess: () => invalidateCourseTree(queryClient, courseId),
  });
}

export function useReorderLessonItems(lessonId: string, courseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) => coursesApi.reorderLessonItems(lessonId, itemIds),
    onSuccess: () => invalidateCourseTree(queryClient, courseId),
  });
}

/** Invalidate the tree that contains a nested node. Fallback: whole list. */
function invalidateCourseTree(queryClient: ReturnType<typeof useQueryClient>, courseId?: string) {
  if (courseId) {
    queryClient.invalidateQueries({ queryKey: courseKeys.detail(courseId) });
  }
  queryClient.invalidateQueries({ queryKey: courseKeys.all });
}

export function useAssignCourseToClass(courseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (classId: string) => coursesApi.assignCourseToClass(courseId, classId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: courseKeys.detail(courseId) }),
  });
}