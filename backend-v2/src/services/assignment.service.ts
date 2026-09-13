import { withTenant } from '../db/tenantContext';
import {
  findEditableCourseForLessonItem,
  findReadableCourseForLessonItem,
  isStaff,
} from './courseAccess';
import { confirmUpload, deleteObject, storageAvailable } from './storage.service';
import type { TokenPayload } from '../utils/jwt';
import type {
  GradeSubmissionInput,
  SubmitAssignmentInput,
  UpdateAssignmentInput,
} from '../validators/assignment.validator';

/**
 * Requirements §12 — assignments: text submission and manual grading.
 *
 * Grading is points-based. A letter grade is derivable from a percentage via a
 * school-level scale later, and rubrics would be an additive table, so this
 * does not foreclose either.
 */

const notFound = (m: string) => Object.assign(new Error(m), { statusCode: 404 });
const forbidden = (m: string) => Object.assign(new Error(m), { statusCode: 403 });
const conflict = (m: string) => Object.assign(new Error(m), { statusCode: 409 });
const badRequest = (m: string) => Object.assign(new Error(m), { statusCode: 400 });
const notImplemented = (m: string) => Object.assign(new Error(m), { statusCode: 501 });

export const updateAssignment = async (
  user: TokenPayload,
  itemId: string,
  input: UpdateAssignmentInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findEditableCourseForLessonItem(tx, itemId, user);

    const existing = await tx.assignment.findUnique({ where: { lessonItemId: itemId } });
    if (!existing) throw notFound('Assignment not found');

    return tx.assignment.update({
      where: { lessonItemId: itemId },
      data: {
        instructions: input.instructions,
        dueAt: input.dueAt === undefined ? undefined : input.dueAt,
        maxPoints: input.maxPoints,
        allowsLate: input.allowsLate,
        allowsFile: input.allowsFile,
      },
    });
  });

export const getAssignment = async (user: TokenPayload, itemId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    await findReadableCourseForLessonItem(tx, itemId, user);

    const assignment = await tx.assignment.findUnique({
      where: { lessonItemId: itemId },
      include: {
        // Staff get the whole pile to mark; a student gets only their own, and
        // only ever their own feedback and marks.
        submissions: isStaff(user.role)
          ? { include: { student: { select: { id: true, name: true } } } }
          : { where: { studentId: user.userId } },
      },
    });
    if (!assignment) throw notFound('Assignment not found');

    return assignment;
  });

/**
 * Creates or replaces the caller's submission.
 *
 * **Lateness is decided by the server**, by comparing the moment of submission
 * with the assignment's stored `due_at`. The client never states when it
 * submitted — the same reasoning as the quiz timer, where accepting a
 * client-supplied `startedAt` made the limit decoration.
 *
 * The flag is *recorded* rather than derived on read, so a teacher who later
 * extends the deadline does not retroactively rewrite whose work was late.
 */
export const submitAssignment = async (
  user: TokenPayload,
  itemId: string,
  input: SubmitAssignmentInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findReadableCourseForLessonItem(tx, itemId, user);

    if (isStaff(user.role)) {
      throw forbidden('Staff do not submit assignments');
    }

    const assignment = await tx.assignment.findUnique({ where: { lessonItemId: itemId } });
    if (!assignment) throw notFound('Assignment not found');

    // A file is only accepted if the assignment asks for one, and only after
    // storage confirms the object exists — otherwise the row would point at
    // nothing and the student would be told it worked.
    let fileKey: string | null = null;
    if (input.fileKey) {
      if (!storageAvailable()) {
        throw notImplemented('File attachments are not available on this server');
      }
      if (!assignment.allowsFile) {
        throw badRequest('This assignment does not accept file attachments');
      }
      fileKey = (await confirmUpload(input.fileKey, user.schoolId!)).key;
    }

    // Text remains required even with a file attached: a submission that is
    // only an opaque blob gives a marker nothing to read in the list view.
    if (!input.bodyText || input.bodyText.trim().length === 0) {
      throw badRequest('A submission needs some text');
    }

    const now = new Date();
    const isLate = assignment.dueAt !== null && now.getTime() > assignment.dueAt.getTime();

    if (isLate && !assignment.allowsLate) {
      throw conflict('The deadline for this assignment has passed');
    }

    const existing = await tx.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId: itemId, studentId: user.userId } },
    });

    // A graded submission is final. Allowing a rewrite after marking would let
    // a student replace the work the mark refers to.
    if (existing?.status === 'GRADED') {
      throw conflict('This submission has already been graded');
    }

    if (existing) {
      const updated = await tx.assignmentSubmission.update({
        where: { id: existing.id },
        data: {
          bodyText: input.bodyText,
          submittedAt: now,
          isLate,
          status: 'SUBMITTED',
          ...(fileKey ? { fileKey } : {}),
        },
      });

      // A replaced attachment leaves the old object orphaned. Deleted only
      // after the row is updated, so a failed delete cannot lose the new file.
      if (fileKey && existing.fileKey && existing.fileKey !== fileKey) {
        await deleteObject(existing.fileKey);
      }

      return updated;
    }

    return tx.assignmentSubmission.create({
      data: {
        schoolId: user.schoolId!,
        assignmentId: itemId,
        studentId: user.userId,
        bodyText: input.bodyText,
        fileKey,
        submittedAt: now,
        isLate,
      },
    });
  });

/**
 * Marks a submission. Staff only, and the mark is bounded by the assignment's
 * own `max_points` — a mark above the maximum silently breaks every average
 * computed from it afterwards.
 */
export const gradeSubmission = async (
  user: TokenPayload,
  submissionId: string,
  input: GradeSubmissionInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    const submission = await tx.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!submission) throw notFound('Submission not found');

    await findEditableCourseForLessonItem(tx, submission.assignmentId, user);

    if (input.points !== undefined && input.points > submission.assignment.maxPoints) {
      throw badRequest(`Points cannot exceed ${submission.assignment.maxPoints}`);
    }

    const returning = input.status === 'RETURNED';

    return tx.assignmentSubmission.update({
      where: { id: submissionId },
      data: {
        // Returned work is not graded work: the mark and grader are cleared so
        // a resubmission is not silently carrying an old score.
        points: returning ? null : input.points,
        feedback: input.feedback,
        status: returning ? 'RETURNED' : 'GRADED',
        gradedBy: returning ? null : user.userId,
        gradedAt: returning ? null : new Date(),
      },
    });
  });

/**
 * Reads one submission. A student may read their own; staff may read any in
 * their school, which is what makes marking possible.
 *
 * 404 rather than 403 for a classmate's: the existence of someone else's
 * submission is not the caller's business either.
 */
export const getSubmission = async (user: TokenPayload, submissionId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    const submission = await tx.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { student: { select: { id: true, name: true } } },
    });
    if (!submission) throw notFound('Submission not found');

    if (!isStaff(user.role) && submission.studentId !== user.userId) {
      throw notFound('Submission not found');
    }

    return submission;
  });
