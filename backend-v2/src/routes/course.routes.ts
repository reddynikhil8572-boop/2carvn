import { Router } from 'express';
import * as ctrl from '../controllers/course.controller';
import * as quizCtrl from '../controllers/quiz.controller';
import * as assignmentCtrl from '../controllers/assignment.controller';
import * as certCtrl from '../controllers/certificate.controller';
import * as videoCtrl from '../controllers/video.controller';
import { heartbeatSchema } from '../validators/video.validator';
import * as uploadCtrl from '../controllers/upload.controller';
import {
  confirmSchema,
  confirmVideoSchema,
  presignSchema,
} from '../validators/upload.validator';
import { issueSchema } from './certificate.routes';
import { requireAuth, requireRole, requireTenant } from '../middlewares/auth';
import { validate, validateParams } from '../middlewares/validate';
import {
  assignClassSchema,
  createChapterSchema,
  createCourseSchema,
  createLessonItemSchema,
  createLessonSchema,
  createModuleSchema,
  idParamSchema,
  reorderSchema,
  updateCourseSchema,
  updateLessonItemSchema,
} from '../validators/course.validator';
import {
  createQuestionSchema,
  submitAttemptSchema,
  updateQuizSchema,
} from '../validators/quiz.validator';
import {
  gradeSubmissionSchema,
  submitAssignmentSchema,
  updateAssignmentSchema,
} from '../validators/assignment.validator';

const router = Router();

/**
 * Requirements §6 — course hierarchy.
 *
 * Every route is tenant-scoped: requireTenant guarantees a schoolId to hand to
 * withTenant(), and RLS makes another school's rows invisible regardless.
 *
 * Authorization *within* the school is not expressed here. Read routes admit
 * every role because what a student may see is a filter, not a yes/no — see
 * services/courseAccess.ts. Write routes are gated to staff at the router AND
 * re-checked per course in the service, because "is a teacher" and "is a
 * teacher on THIS course" are different questions.
 *
 * Middleware is attached per route rather than with router.use(), so an
 * unmatched path under this prefix still reaches the JSON 404 handler instead
 * of being turned into a 401 by the auth guard.
 */
const tenant = () => [requireAuth, requireTenant] as const;
const staffOnly = requireRole(['SCHOOL_ADMIN', 'TEACHER']);

// ── Read ───────────────────────────────────────────────────────────────────
router.get('/', ...tenant(), ctrl.listCourses);
router.get('/:id', ...tenant(), validateParams(idParamSchema), ctrl.getCourse);

// ── Authoring ──────────────────────────────────────────────────────────────
router.post('/', ...tenant(), staffOnly, validate(createCourseSchema), ctrl.createCourse);
router.patch(
  '/:id',
  ...tenant(),
  staffOnly,
  validateParams(idParamSchema),
  validate(updateCourseSchema),
  ctrl.updateCourse
);

router.post(
  '/:id/modules',
  ...tenant(),
  staffOnly,
  validateParams(idParamSchema),
  validate(createModuleSchema),
  ctrl.createModule
);

router.post(
  '/:id/classes',
  ...tenant(),
  staffOnly,
  validateParams(idParamSchema),
  validate(assignClassSchema),
  ctrl.assignClass
);

// §10 certificates. Issuing is course-scoped; the public verification pair
// lives in certificate.routes.ts, deliberately in a router with no auth.
router.post(
  '/:id/certificates',
  ...tenant(),
  staffOnly,
  validateParams(idParamSchema),
  validate(issueSchema),
  certCtrl.issueCertificate
);
router.get(
  '/:id/certificates',
  ...tenant(),
  validateParams(idParamSchema),
  certCtrl.listCertificates
);

// Course cover image.
router.post(
  '/:id/cover/upload-url',
  ...tenant(),
  staffOnly,
  validateParams(idParamSchema),
  validate(presignSchema),
  uploadCtrl.presignCoverUpload
);
router.post(
  '/:id/cover/confirm',
  ...tenant(),
  staffOnly,
  validateParams(idParamSchema),
  validate(confirmSchema),
  uploadCtrl.confirmCoverUpload
);
router.get('/:id/cover', ...tenant(), validateParams(idParamSchema), uploadCtrl.getCoverUrl);

// §8 — course-level video analytics, staff only.
router.get(
  '/:id/analytics/video',
  ...tenant(),
  staffOnly,
  validateParams(idParamSchema),
  videoCtrl.courseVideoAnalytics
);

export default router;

/**
 * Levels below Course are addressed by their own id rather than nested under
 * /courses/:id, so a client holding a lesson id does not have to reconstruct
 * the path above it. Authorization still resolves up to the course either way.
 *
 * These are exported as separate routers mounted on their own prefixes rather
 * than as one router mounted at '/'. A router carrying `use(requireAuth)`
 * mounted at the API root applies that middleware to every unmatched path too,
 * which turns the JSON 404 handler into a 401 for any unknown route.
 */
const authoring = () => [requireAuth, requireTenant, staffOnly] as const;

export const moduleRouter = Router();
moduleRouter.post(
  '/:id/chapters',
  ...authoring(),
  validateParams(idParamSchema),
  validate(createChapterSchema),
  ctrl.createChapter
);

export const chapterRouter = Router();
chapterRouter.post(
  '/:id/lessons',
  ...authoring(),
  validateParams(idParamSchema),
  validate(createLessonSchema),
  ctrl.createLesson
);

export const lessonRouter = Router();
lessonRouter.post(
  '/:id/items',
  ...authoring(),
  validateParams(idParamSchema),
  validate(createLessonItemSchema),
  ctrl.createLessonItem
);
lessonRouter.post(
  '/:id/items/reorder',
  ...authoring(),
  validateParams(idParamSchema),
  validate(reorderSchema),
  ctrl.reorderLessonItems
);

export const lessonItemRouter = Router();
lessonItemRouter.patch(
  '/:id',
  ...authoring(),
  validateParams(idParamSchema),
  validate(updateLessonItemSchema),
  ctrl.updateLessonItem
);

// ── §12 assessments ────────────────────────────────────────────────────────
//
// Quizzes are addressed by their lesson item id, since the two share a primary
// key. Reads admit students — what they get back is a narrower projection, not
// a different route (services/quizProjection.ts).
lessonItemRouter.get(
  '/:id/quiz',
  ...tenant(),
  validateParams(idParamSchema),
  quizCtrl.getQuiz
);
lessonItemRouter.patch(
  '/:id/quiz',
  ...authoring(),
  validateParams(idParamSchema),
  validate(updateQuizSchema),
  quizCtrl.updateQuiz
);
lessonItemRouter.post(
  '/:id/questions',
  ...authoring(),
  validateParams(idParamSchema),
  validate(createQuestionSchema),
  quizCtrl.createQuestion
);
lessonItemRouter.post(
  '/:id/attempts',
  ...tenant(),
  validateParams(idParamSchema),
  quizCtrl.startAttempt
);
lessonItemRouter.get(
  '/:id/attempts',
  ...tenant(),
  validateParams(idParamSchema),
  quizCtrl.listAttempts
);

// Assignments, also addressed by their lesson item id.
lessonItemRouter.get(
  '/:id/assignment',
  ...tenant(),
  validateParams(idParamSchema),
  assignmentCtrl.getAssignment
);
lessonItemRouter.patch(
  '/:id/assignment',
  ...authoring(),
  validateParams(idParamSchema),
  validate(updateAssignmentSchema),
  assignmentCtrl.updateAssignment
);
lessonItemRouter.post(
  '/:id/submissions',
  ...tenant(),
  validateParams(idParamSchema),
  validate(submitAssignmentSchema),
  assignmentCtrl.submitAssignment
);

// ── Object storage ─────────────────────────────────────────────────────────
//
// Presign then confirm, in two calls, because the bytes go straight from the
// browser to storage without transiting the API. The confirm step is what
// proves the object exists before any column points at it.
lessonItemRouter.post(
  '/:id/video/upload-url',
  ...authoring(),
  validateParams(idParamSchema),
  validate(presignSchema),
  uploadCtrl.presignVideoUpload
);
lessonItemRouter.post(
  '/:id/video/confirm',
  ...authoring(),
  validateParams(idParamSchema),
  validate(confirmVideoSchema),
  uploadCtrl.confirmVideoUpload
);
/// Read rules, not edit rules — this is what a student calls to play a video.
lessonItemRouter.get(
  '/:id/video/url',
  ...tenant(),
  validateParams(idParamSchema),
  uploadCtrl.getVideoUrl
);

lessonItemRouter.post(
  '/:id/submissions/upload-url',
  ...tenant(),
  validateParams(idParamSchema),
  validate(presignSchema),
  uploadCtrl.presignSubmissionUpload
);

// ── §7 video tracking ──────────────────────────────────────────────────────
//
// Heartbeats are the single highest-frequency write in the product (one per
// student per ~15s of playback), so they stay a narrow endpoint rather than
// being folded into a general progress route.
lessonItemRouter.post(
  '/:id/progress',
  ...tenant(),
  validateParams(idParamSchema),
  validate(heartbeatSchema),
  videoCtrl.recordHeartbeat
);
lessonItemRouter.get(
  '/:id/progress',
  ...tenant(),
  validateParams(idParamSchema),
  videoCtrl.getOwnProgress
);
/// Staff only — the whole class's figures for one video.
lessonItemRouter.get(
  '/:id/progress/all',
  ...authoring(),
  validateParams(idParamSchema),
  videoCtrl.listProgressForItem
);

export const submissionRouter = Router();
submissionRouter.get(
  '/:id',
  ...tenant(),
  validateParams(idParamSchema),
  assignmentCtrl.getSubmission
);
submissionRouter.get(
  '/:id/file',
  ...tenant(),
  validateParams(idParamSchema),
  uploadCtrl.getSubmissionFileUrl
);
submissionRouter.post(
  '/:id/grade',
  ...authoring(),
  validateParams(idParamSchema),
  validate(gradeSubmissionSchema),
  assignmentCtrl.gradeSubmission
);

export const attemptRouter = Router();
attemptRouter.get('/:id', ...tenant(), validateParams(idParamSchema), quizCtrl.getAttempt);
attemptRouter.post(
  '/:id/submit',
  ...tenant(),
  validateParams(idParamSchema),
  validate(submitAttemptSchema),
  quizCtrl.submitAttempt
);
