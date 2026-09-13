import { api } from './client';

import type {
  CourseSummary,
  CourseTree,
  ModuleView,
  ChapterView,
  LessonView,
  LessonItemView,
} from '@/types/models';
import type { CourseStatus, LessonItemKind, VideoProvider, ApiEnvelope } from '@/types/api';

/** Course hierarchy — wraps backend-v2/src/routes/course.routes.ts. */

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listCourses(): Promise<CourseSummary[]> {
  const res = await api.get<ApiEnvelope<CourseSummary[]>>('/courses');
  return res.data.data;
}

export async function getCourse(id: string): Promise<CourseTree> {
  const res = await api.get<ApiEnvelope<CourseTree>>(`/courses/${id}`);
  return res.data.data;
}

// ── Course CRUD ────────────────────────────────────────────────────────────

export interface CreateCoursePayload {
  title: string;
  slug?: string;
  description?: string;
  subject?: string;
}

export async function createCourse(payload: CreateCoursePayload): Promise<CourseSummary> {
  const res = await api.post<ApiEnvelope<CourseSummary>>('/courses', payload);
  return res.data.data;
}

export interface UpdateCoursePayload {
  title?: string;
  description?: string;
  subject?: string;
  status?: CourseStatus;
}

export async function updateCourse(id: string, payload: UpdateCoursePayload): Promise<CourseSummary> {
  const res = await api.patch<ApiEnvelope<CourseSummary>>(`/courses/${id}`, payload);
  return res.data.data;
}

// ── Hierarchy authoring ────────────────────────────────────────────────────

export interface CreateModulePayload {
  title: string;
  position?: number;
}

export async function createModule(courseId: string, payload: CreateModulePayload): Promise<ModuleView> {
  const res = await api.post<ApiEnvelope<ModuleView>>(`/courses/${courseId}/modules`, payload);
  return res.data.data;
}

export interface CreateChapterPayload {
  title: string;
  position?: number;
}

export async function createChapter(moduleId: string, payload: CreateChapterPayload): Promise<ChapterView> {
  const res = await api.post<ApiEnvelope<ChapterView>>(`/modules/${moduleId}/chapters`, payload);
  return res.data.data;
}

export interface CreateLessonPayload {
  title: string;
  summary?: string;
  position?: number;
}

export async function createLesson(chapterId: string, payload: CreateLessonPayload): Promise<LessonView> {
  const res = await api.post<ApiEnvelope<LessonView>>(`/chapters/${chapterId}/lessons`, payload);
  return res.data.data;
}

export type CreateLessonItemPayload =
  | {
      kind: 'VIDEO';
      title: string;
      position?: number;
      isPublished?: boolean;
      provider?: VideoProvider;
      externalUrl?: string;
      durationSeconds?: number;
    }
  | {
      kind: 'QUIZ';
      title: string;
      position?: number;
      isPublished?: boolean;
      instructions?: string;
      passingScore?: number;
      timeLimitMinutes?: number;
      maxAttempts?: number;
      shuffleQuestions?: boolean;
    }
  | {
      kind: 'ASSIGNMENT';
      title: string;
      position?: number;
      isPublished?: boolean;
      instructions?: string;
      dueAt?: Date;
      maxPoints?: number;
      allowsLate?: boolean;
      allowsFile?: boolean;
    };

export async function createLessonItem(
  lessonId: string,
  payload: CreateLessonItemPayload,
): Promise<LessonItemView> {
  const res = await api.post<ApiEnvelope<LessonItemView>>(`/lessons/${lessonId}/items`, payload);
  return res.data.data;
}

export interface UpdateLessonItemPayload {
  title?: string;
  position?: number;
  isPublished?: boolean;
  provider?: VideoProvider;
  externalUrl?: string;
  durationSeconds?: number;
}

export async function updateLessonItem(itemId: string, payload: UpdateLessonItemPayload): Promise<LessonItemView> {
  const res = await api.patch<ApiEnvelope<LessonItemView>>(`/items/${itemId}`, payload);
  return res.data.data;
}

export async function reorderLessonItems(lessonId: string, itemIds: string[]): Promise<{ success: boolean }> {
  const res = await api.post(`/lessons/${lessonId}/items/reorder`, { itemIds });
  return res.data;
}

// ── Class assignment ───────────────────────────────────────────────────────

export async function assignCourseToClass(courseId: string, classId: string): Promise<void> {
  const res = await api.post(`/courses/${courseId}/classes`, { classId });
  return res.data.data;
}

/** Utility: kind-specific guard passed a lesson item. */
export function lessonItemKind(item: LessonItemView): LessonItemKind {
  return item.kind;
}