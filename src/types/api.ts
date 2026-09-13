/**
 * Shared API types. The envelope mirrors the backend's utils/responseFormat.ts,
 * and the domain enums mirror the Prisma schema. Nothing here is invented — a
 * field that the backend does not return is not declared.
 */

/** Success/error envelope returned by every backend endpoint. */
export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  statusCode?: number;
  data: T;
}

/** Extra structured detail the backend attaches to error responses. */
export interface ApiErrorMeta {
  /** e.g. ACCOUNT_LOCKED, RESET_TOKEN_INVALID */
  code?: string;
  /** Seconds until an account lockout/unlock can be retried. */
  retryAfter?: number;
  /** Login failures remaining before lockout. */
  attemptsRemaining?: number;
  /** Present on 5xx responses; matches the X-Request-Id header. */
  requestId?: string;
  /** Human-readable reason for a failed operation (e.g. 2FA). */
  reason?: string;
  [key: string]: unknown;
}

/** Zod validation failure shape produced by Express error middleware. */
export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  success: boolean;
  message: string;
  statusCode?: number;
  data: ApiErrorMeta | null;
  errors?: ValidationIssue[];
}

// ── Domain enums (mirror the Prisma schema) ────────────────────────────────
export type Plan = 'BASIC' | 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
export type UserRole = 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type LessonItemKind = 'VIDEO' | 'QUIZ' | 'ASSIGNMENT';
export type VideoProvider = 'UPLOAD' | 'YOUTUBE' | 'VIMEO';
export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
export type SubmissionStatus = 'SUBMITTED' | 'GRADED' | 'RETURNED';
export type VideoEventType = 'PLAY' | 'PAUSE' | 'SEEK' | 'ENDED' | 'HEARTBEAT';

/** The staff roles that may author content. */
export const STAFF_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles a school admin may create (never SUPER_ADMIN — enforced by backend). */
export const CREATABLE_ROLES: readonly Exclude<UserRole, 'SUPER_ADMIN'>[] = [
  'SCHOOL_ADMIN',
  'TEACHER',
  'STUDENT',
  'PARENT',
];