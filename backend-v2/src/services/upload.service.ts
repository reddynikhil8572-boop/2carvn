import { withTenant } from '../db/tenantContext';
import {
  findEditableCourse,
  findEditableCourseForLessonItem,
  findReadableCourseForLessonItem,
  isStaff,
} from './courseAccess';
import * as storage from './storage.service';
import type { TokenPayload } from '../utils/jwt';
import type { ConfirmVideoInput, PresignInput } from '../validators/upload.validator';

/**
 * Ties object storage to the domain: who may upload what, and which column the
 * resulting key lands in.
 *
 * Every function here reuses an existing authorization helper from
 * `courseAccess.ts` rather than writing a fresh check. Storage is a new
 * capability, not a new permission model — a teacher who may edit a course may
 * upload its video, and a student who may read a lesson item may fetch its
 * video URL. Inventing parallel rules here is how the two drift apart.
 */

const notFound = (m: string) => Object.assign(new Error(m), { statusCode: 404 });
const forbidden = (m: string) => Object.assign(new Error(m), { statusCode: 403 });
const badRequest = (m: string) => Object.assign(new Error(m), { statusCode: 400 });

// ── Lesson video ───────────────────────────────────────────────────────────

export const presignVideoUpload = async (
  user: TokenPayload,
  itemId: string,
  input: PresignInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findEditableCourseForLessonItem(tx, itemId, user);

    const item = await tx.lessonItem.findFirst({
      where: { id: itemId, kind: 'VIDEO' },
      select: { id: true },
    });
    if (!item) throw notFound('Video item not found');

    return storage.presignUpload({
      schoolId: user.schoolId!,
      kind: 'video',
      contentType: input.contentType,
    });
  });

/**
 * Records an uploaded video against the item.
 *
 * `durationSeconds` comes from the client, because reading it server-side would
 * mean downloading and probing the file. It is metadata, not a claim about
 * watching — but §7's completion rule divides by it, so its accuracy matters.
 *
 * It may be **null**, when the uploader's browser could not parse the
 * container. That is deliberate: a missing duration makes progress
 * percentages unavailable (0%, never complete), whereas a fabricated one makes
 * them wrong in a way nobody notices. Unknown beats confidently incorrect.
 */
export const confirmVideoUpload = async (
  user: TokenPayload,
  itemId: string,
  input: ConfirmVideoInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findEditableCourseForLessonItem(tx, itemId, user);

    const existing = await tx.videoAsset.findUnique({ where: { lessonItemId: itemId } });
    if (!existing) throw notFound('Video item not found');

    // Proves the object exists before any column points at it.
    const object = await storage.confirmUpload(input.key, user.schoolId!);

    const previousKey = existing.storageKey;

    const asset = await tx.videoAsset.update({
      where: { lessonItemId: itemId },
      data: {
        storageKey: object.key,
        provider: 'UPLOAD',
        durationSeconds: input.durationSeconds,
        // An uploaded file supersedes any external link, or the player would
        // have two sources and have to guess.
        externalUrl: null,
      },
    });

    // Replacing a video leaves the old object orphaned. Deleted after the row
    // is updated, so a failed delete cannot lose the new upload.
    if (previousKey && previousKey !== object.key) {
      await storage.deleteObject(previousKey);
    }

    return asset;
  });

/**
 * A playable URL for a video.
 *
 * Read rules, not edit rules — this is the endpoint a student hits. It resolves
 * up to the course, so being in the school is not enough: a course assigned to
 * another class stays unreachable.
 */
export const getVideoUrl = async (user: TokenPayload, itemId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    await findReadableCourseForLessonItem(tx, itemId, user);

    const asset = await tx.videoAsset.findUnique({ where: { lessonItemId: itemId } });
    if (!asset) throw notFound('Video not found');

    // An externally hosted video needs no signing — it was never ours.
    if (!asset.storageKey) {
      if (asset.externalUrl) {
        return { url: asset.externalUrl, external: true, durationSeconds: asset.durationSeconds };
      }
      throw notFound('This video has no source yet');
    }

    if (!storage.keyBelongsToSchool(asset.storageKey, user.schoolId!)) {
      // Only reachable if a row was written wrong. Refuse rather than sign it.
      throw forbidden('This video belongs to another school');
    }

    return {
      url: await storage.presignDownload(asset.storageKey),
      external: false,
      durationSeconds: asset.durationSeconds,
    };
  });

// ── Assignment attachments ─────────────────────────────────────────────────

export const presignSubmissionUpload = async (
  user: TokenPayload,
  itemId: string,
  input: PresignInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findReadableCourseForLessonItem(tx, itemId, user);

    if (isStaff(user.role)) throw forbidden('Staff do not submit assignments');

    const assignment = await tx.assignment.findUnique({ where: { lessonItemId: itemId } });
    if (!assignment) throw notFound('Assignment not found');

    // The flag has to gate the presign, not only the submit. Handing out an
    // upload URL for an assignment that refuses files wastes the student's
    // upload and then rejects them.
    if (!assignment.allowsFile) {
      throw badRequest('This assignment does not accept file attachments');
    }

    return storage.presignUpload({
      schoolId: user.schoolId!,
      kind: 'submission',
      contentType: input.contentType,
    });
  });

/**
 * A download URL for a submitted file.
 *
 * Owner or staff, the same rule as reading the submission itself — and 404
 * rather than 403 for a classmate, so the existence of someone else's work is
 * not confirmed.
 */
export const getSubmissionFileUrl = async (user: TokenPayload, submissionId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    const submission = await tx.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { student: { select: { name: true } } },
    });
    if (!submission) throw notFound('Submission not found');

    if (!isStaff(user.role) && submission.studentId !== user.userId) {
      throw notFound('Submission not found');
    }

    if (!submission.fileKey) throw notFound('This submission has no attachment');

    if (!storage.keyBelongsToSchool(submission.fileKey, user.schoolId!)) {
      throw forbidden('That file belongs to another school');
    }

    return {
      // attachment, not inline: an uploaded HTML or SVG rendered in the
      // origin's context is a stored-XSS vector.
      url: await storage.presignDownload(submission.fileKey, {
        attachment: true,
        filename: `${submission.student.name}-submission`,
      }),
    };
  });

// ── Course cover image ─────────────────────────────────────────────────────

export const presignCoverUpload = async (
  user: TokenPayload,
  courseId: string,
  input: PresignInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findEditableCourse(tx, courseId, user);

    return storage.presignUpload({
      schoolId: user.schoolId!,
      kind: 'cover',
      contentType: input.contentType,
    });
  });

export const confirmCoverUpload = async (user: TokenPayload, courseId: string, key: string) =>
  withTenant(user.schoolId!, async (tx) => {
    const course = await findEditableCourse(tx, courseId, user);

    const object = await storage.confirmUpload(key, user.schoolId!);
    const previousKey = course.coverImageKey;

    const updated = await tx.course.update({
      where: { id: courseId },
      data: { coverImageKey: object.key },
    });

    if (previousKey && previousKey !== object.key) {
      await storage.deleteObject(previousKey);
    }

    return updated;
  });

export const getCoverUrl = async (user: TokenPayload, courseId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: courseId },
      select: { coverImageKey: true },
    });
    if (!course?.coverImageKey) throw notFound('This course has no cover image');

    if (!storage.keyBelongsToSchool(course.coverImageKey, user.schoolId!)) {
      throw forbidden('That image belongs to another school');
    }

    return { url: await storage.presignDownload(course.coverImageKey) };
  });
