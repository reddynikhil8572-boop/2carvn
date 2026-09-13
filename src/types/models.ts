import type {
  AttemptStatus,
  CourseStatus,
  LessonItemKind,
  Plan,
  SubmissionStatus,
  UserRole,
  UserStatus,
  VideoProvider,
} from './api';

/**
 * Domain models, typed to the exact shapes the backend returns. Keep these in
 * sync with backend-v2 (Prisma schema + controller projections) — changing the
 * backend without updating this file is a runtime bug waiting to happen.
 */

// ── Auth / session ─────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  schoolId: string | null;
  avatarUrl: string | null;
}

/** GET /auth/me — tenant users additionally receive their school's branding. */
export interface MeResponse extends AuthUser {
  school?: {
    schoolCode: string;
    name: string;
    primaryColor: string | null;
    logoUrl: string | null;
  } | null;
}

/**
 * User object as returned at login / by 2FA verify. Note it is deliberately
 * narrower than AuthUser — no email on the 2FA path, no avatarUrl anywhere;
 * GET /auth/me is the only endpoint that returns the full profile.
 */
export interface LoginUser {
  id: string;
  name: string;
  role: UserRole;
  schoolId: string | null;
}

/** Login without 2FA — the backend includes the email it authenticated. */
export interface LoginSuccess extends LoginUser {
  email: string;
}

/** The shape the login endpoint returns when 2FA is OFF (session issued). */
export interface LoginResponse {
  twoFactorRequired: false;
  user: LoginSuccess;
}

export interface TwoFactorChallengeResponse {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
}

export interface TwoFactorLoginResponse {
  user: LoginUser;
  usedRecoveryCode: boolean;
  remainingRecoveryCodes: number;
}

// ── School (tenant) ────────────────────────────────────────────────────────

export interface School {
  id: string;
  schoolCode: string;
  name: string;
  city: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  customDomain: string | null;
  plan: Plan;
  studentCap: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present on the super-admin listing. */
  userCount?: number;
}

export interface CreateSchoolResponse extends School {
  admin: { id: string; email: string; name: string; role: UserRole };
  adminMustResetPassword: boolean;
}

// ── Users ──────────────────────────────────────────────────────────────────

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  erasedAt: string | null;
  createdAt: string;
}

export interface CreateUserResponse extends Pick<UserSummary, 'id' | 'email' | 'name' | 'role' | 'status' | 'createdAt'> {
  /** True when the account was created without a password and emailed a link. */
  mustSetPassword: boolean;
}

export interface UserExport {
  exportedAt: string;
  subject: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    role: UserRole;
    status: UserStatus;
    lastLoginAt: string | null;
    erasedAt: string | null;
    createdAt: string;
    updatedAt: string;
    school: { schoolCode: string; name: string } | null;
  };
  enrollments: Array<{ enrolledAt: string; class: { name: string; academicYear: string } }>;
  taughtClasses: Array<{ name: string; academicYear: string; createdAt: string }>;
  quizAttempts: unknown[];
  assignmentSubmissions: unknown[];
  certificates: unknown[];
  videoProgress: unknown[];
  videoEvents: unknown[];
  parents: Array<{ name: string; email: string }>;
  children: Array<{ name: string; email: string }>;
  auditLog: Array<{ action: string; metadata: unknown; createdAt: string }>;
  counts: {
    enrollments: number;
    taughtClasses: number;
    quizAttempts: number;
    assignmentSubmissions: number;
    certificates: number;
    videoProgress: number;
    videoEvents: number;
    auditLog: number;
  };
}

/** DELETE /school-admin/users/:id — erasure report (anonymisation, not delete). */
export interface ErasureReport {
  userId: string;
  erasedAt: string;
  overwritten: string[];
  deleted: Record<string, number>;
  retained: Record<string, number>;
  certificates: { revoked: number; untouched: number };
  storage: { total: number; deleted: number; failed: number };
  note: string;
}

// ── Classes & enrollment ───────────────────────────────────────────────────

export interface ClassSummary {
  id: string;
  schoolId: string;
  name: string;
  academicYear: string;
  teacherId: string | null;
  teacher: { id: string; name: string } | null;
  /** Present on list responses; absent on create (backend returns a bare row). */
  _count?: { enrollments: number };
  createdAt: string;
  updatedAt: string;
}

export interface ClassDetail extends Omit<ClassSummary, '_count'> {}

export interface Enrollment {
  id: string;
  classId: string;
  studentId: string;
  enrolledAt: string;
  student: { id: string; name: string; email: string };
}

// ── Course hierarchy ───────────────────────────────────────────────────────

export interface CourseSummary {
  id: string;
  schoolId: string;
  title: string;
  slug: string;
  description: string | null;
  subject: string | null;
  coverImageKey: string | null;
  status: CourseStatus;
  publishedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Present on list responses; absent on create (backend returns a bare row). */
  _count?: { modules: number; assignments: number };
}

export interface CourseClassAssignment {
  id: string;
  courseId: string;
  classId: string;
  assignedAt: string;
  class: { id: string; name: string };
}

export interface VideoAsset {
  lessonItemId: string;
  schoolId: string;
  storageKey: string | null;
  provider: VideoProvider;
  externalUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Quiz options exactly as returned: isCorrect present for staff only. */
export interface QuizOptionView {
  id: string;
  text: string;
  position: number;
  isCorrect?: boolean;
}

export interface QuizQuestionView {
  id: string;
  prompt: string;
  position: number;
  points: number;
  options: QuizOptionView[];
}

export interface QuizView {
  lessonItemId: string;
  instructions: string | null;
  passingScore: number;
  timeLimitMinutes: number | null;
  maxAttempts: number;
  shuffleQuestions: boolean;
  /** Present on GET /items/:id/quiz; absent on create/update responses (scalar rows). */
  questions?: QuizQuestionView[];
}

export interface AssignmentView {
  lessonItemId: string;
  instructions: string | null;
  dueAt: string | null;
  maxPoints: number;
  allowsLate: boolean;
  allowsFile: boolean;
}

export interface LessonItemView {
  id: string;
  lessonId: string;
  kind: LessonItemKind;
  title: string;
  position: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  video?: VideoAsset | null;
  quiz?: QuizView | null;
  assignment?: AssignmentView | null;
}

export interface LessonView {
  id: string;
  chapterId: string;
  title: string;
  summary: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  items: LessonItemView[];
}

export interface ChapterView {
  id: string;
  moduleId: string;
  title: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  lessons: LessonView[];
}

export interface ModuleView {
  id: string;
  courseId: string;
  title: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  chapters: ChapterView[];
}

export interface CourseTree extends CourseSummary {
  modules: ModuleView[];
  assignments: CourseClassAssignment[];
}

// ── Video tracking ─────────────────────────────────────────────────────────

export interface VideoUrlResponse {
  url: string;
  external: boolean;
  durationSeconds: number | null;
}

export interface VideoProgress {
  id: string;
  schoolId: string;
  lessonItemId: string;
  studentId: string;
  watchedSeconds: number;
  lastPositionSeconds: number;
  furthestPositionSeconds: number;
  percentComplete: number;
  completedAt: string | null;
  replayCount: number;
  lastPlaybackRate: number | null;
  lastDevice: string | null;
  firstWatchedAt: string;
  updatedAt: string;
}

export interface VideoProgressWithStudent extends VideoProgress {
  student: { id: string; name: string };
}

export interface CourseVideoItem {
  lessonItemId: string;
  title: string;
  durationSeconds: number | null;
  audience: number;
  started: number;
  completed: number;
  averagePercent: number;
  totalWatchedSeconds: number;
}

export interface CourseVideoAnalytics {
  audience: number;
  videos: CourseVideoItem[];
}

// ── Quizzes ────────────────────────────────────────────────────────────────

export interface QuizAttempt {
  id: string;
  quizId: string;
  studentId: string;
  attemptNumber: number;
  startedAt: string;
  expiresAt: string | null;
  submittedAt: string | null;
  status: AttemptStatus;
  pointsEarned: number | null;
  pointsPossible: number | null;
  passed: boolean | null;
  integrityFlags: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  student?: { id: string; name: string };
  answers?: Array<{ questionId: string; selectedOptionId: string }>;
}

// ── Assignments ────────────────────────────────────────────────────────────

export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  submittedAt: string;
  bodyText: string | null;
  fileKey: string | null;
  isLate: boolean;
  status: SubmissionStatus;
  points: number | null;
  feedback: string | null;
  gradedBy: string | null;
  gradedAt: string | null;
  createdAt: string;
  updatedAt: string;
  student?: { id: string; name: string };
}

export interface AssignmentWithSubmissions extends AssignmentView {
  submissions: AssignmentSubmission[];
}

// ── Certificates ───────────────────────────────────────────────────────────

export interface Certificate {
  id: string;
  schoolId: string;
  courseId: string;
  studentId: string;
  serial: string;
  courseTitle: string;
  studentName: string;
  schoolName: string;
  issuedAt: string;
  issuedBy: string;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateVerification {
  serial: string;
  studentName: string;
  courseTitle: string;
  schoolName: string;
  issuedAt: string;
  valid: boolean;
  revokedAt: string | null;
  revokeReason: string | null;
}

// ── Object storage ─────────────────────────────────────────────────────────

export interface PresignedUpload {
  key: string;
  url: string;
  fields: Record<string, string>;
  maxBytes: number;
  expiresIn: number;
}

export interface UploadRules {
  maxBytes: number;
  contentTypes: string[];
}

// ── 2FA ────────────────────────────────────────────────────────────────────

export interface TwoFactorStatus {
  enabled: boolean;
  pendingSetup: boolean;
  remainingRecoveryCodes: number;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
}