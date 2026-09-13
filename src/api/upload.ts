import { api } from './client';

import type { PresignedUpload, UploadRules } from '@/types/models';
import type { ApiEnvelope } from '@/types/api';

/**
 * Object storage — wraps backend-v2/src/routes/course.routes.ts upload routes.
 *
 * Every flow is: presign → browser uploads bytes DIRECTLY to storage → confirm.
 * The API never proxies the bytes.
 */

// ── Presign ────────────────────────────────────────────────────────────────

/**
 * Backend presignSchema is `.strict()` and accepts exactly `{ contentType }` —
 * no file size, no other keys (backend-v2/src/validators/upload.validator.ts).
 * The backend enforces size limits when the upload is confirmed.
 */
export interface PresignPayload {
  contentType: string;
}

export async function presignCoverUpload(courseId: string, payload: PresignPayload): Promise<PresignedUpload> {
  const res = await api.post<ApiEnvelope<PresignedUpload>>(`/courses/${courseId}/cover/upload-url`, payload);
  return res.data.data;
}

export async function presignVideoUpload(itemId: string, payload: PresignPayload): Promise<PresignedUpload> {
  const res = await api.post<ApiEnvelope<PresignedUpload>>(`/items/${itemId}/video/upload-url`, payload);
  return res.data.data;
}

export async function presignSubmissionUpload(itemId: string, payload: PresignPayload): Promise<PresignedUpload> {
  const res = await api.post<ApiEnvelope<PresignedUpload>>(`/items/${itemId}/submissions/upload-url`, payload);
  return res.data.data;
}

// ── Confirm ────────────────────────────────────────────────────────────────

export async function confirmCoverUpload(courseId: string, key: string): Promise<void> {
  const res = await api.post(`/courses/${courseId}/cover/confirm`, { key });
  return res.data.data;
}

export interface ConfirmVideoUploadPayload {
  key: string;
  /** Always send — the validator requires the key present even though it may be null. */
  durationSeconds: number | null;
}

export async function confirmVideoUpload(itemId: string, payload: ConfirmVideoUploadPayload): Promise<void> {
  const res = await api.post(`/items/${itemId}/video/confirm`, payload);
  return res.data.data;
}

// ── Read URLs ──────────────────────────────────────────────────────────────

export async function getCoverUrl(courseId: string): Promise<{ url: string | null }> {
  const res = await api.get<ApiEnvelope<{ url: string | null }>>(`/courses/${courseId}/cover`);
  return res.data.data;
}

/**
 * Upload bytes directly to object storage with the signed fields. Returns the
 * storage key on success. `file` from a hidden input; `upload` from presign.
 */
export async function uploadBytesToStorage(
  upload: PresignedUpload,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const form = new FormData();
  // S3 presigned POST requires the fields (policy, signature, …) BEFORE the
  // file field. Order matters to virtually every object-storage backend.
  for (const [key, value] of Object.entries(upload.fields)) {
    form.append(key, value);
  }
  form.append('file', file);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', upload.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      // 2xx from the storage backend is a success; the body is the storage
      // provider's own response (often empty) and must not be parsed as JSON.
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload failed — network error'));
    xhr.send(form);
  });
}

// ── Orchestrated flows ─────────────────────────────────────────────────────
// Each concat presign → direct upload → confirm, so pages never see the pieces.

/** Read a video file's duration client-side (used to back the heartbeat math). */
export function probeVideoDuration(file: File): Promise<number> {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}

export async function uploadCover(
  courseId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const upload = await presignCoverUpload(courseId, {
    contentType: file.type || 'application/octet-stream',
  });
  await uploadBytesToStorage(upload, file, onProgress);
  await confirmCoverUpload(courseId, upload.key);
}

export async function uploadVideo(
  itemId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ key: string; durationSeconds: number }> {
  const upload = await presignVideoUpload(itemId, {
    contentType: file.type || 'video/mp4',
  });
  await uploadBytesToStorage(upload, file, onProgress);
  const durationSeconds = await probeVideoDuration(file);
  await confirmVideoUpload(itemId, { key: upload.key, durationSeconds });
  return { key: upload.key, durationSeconds };
}

/**
 * Upload an assignment submission file. Returns the storage key to pass as
 * `fileKey` on POST /items/:id/submissions (there is no separate confirm step).
 */
export async function uploadSubmissionFile(
  itemId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const upload = await presignSubmissionUpload(itemId, {
    contentType: file.type || 'application/octet-stream',
  });
  await uploadBytesToStorage(upload, file, onProgress);
  return upload.key;
}

export type { UploadRules };