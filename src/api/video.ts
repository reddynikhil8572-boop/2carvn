import { api } from './client';

import type {
  VideoUrlResponse,
  VideoProgress,
  VideoProgressWithStudent,
  CourseVideoAnalytics,
} from '@/types/models';
import type { VideoEventType, ApiEnvelope } from '@/types/api';

/** Video playback + tracking — wraps backend-v2/src/routes/course.routes.ts video routes. */

export async function getVideoUrl(itemId: string): Promise<VideoUrlResponse> {
  const res = await api.get<ApiEnvelope<VideoUrlResponse>>(`/items/${itemId}/video/url`);
  return res.data.data;
}

export interface HeartbeatPayload {
  type?: VideoEventType;
  positionSeconds: number;
  watchedSecondsDelta?: number;
  intervalSeconds?: number;
  playbackRate?: number;
  device?: string;
}

/**
 * The heartbeat body deliberately carries NO client timestamp — the backend
 * records its own clock and clamps credited watch time to real elapsed time.
 * Keep it that way (backend-v2/src/validators/video.validator.ts).
 */
export async function recordHeartbeat(itemId: string, payload: HeartbeatPayload): Promise<VideoProgress> {
  const res = await api.post<ApiEnvelope<VideoProgress>>(`/items/${itemId}/progress`, payload);
  return res.data.data;
}

/** The backend resolves to `null` for a student with no progress row yet (no 404). */
export async function getOwnProgress(itemId: string): Promise<VideoProgress | null> {
  const res = await api.get<ApiEnvelope<VideoProgress | null>>(`/items/${itemId}/progress`);
  return res.data.data;
}

export async function listProgressForItem(itemId: string): Promise<VideoProgressWithStudent[]> {
  const res = await api.get<ApiEnvelope<VideoProgressWithStudent[]>>(`/items/${itemId}/progress/all`);
  return res.data.data;
}

export async function getCourseVideoAnalytics(courseId: string): Promise<CourseVideoAnalytics> {
  const res = await api.get<ApiEnvelope<CourseVideoAnalytics>>(`/courses/${courseId}/analytics/video`);
  return res.data.data;
}