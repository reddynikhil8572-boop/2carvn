import crypto from 'node:crypto';
import { withTenant } from '../db/tenantContext';
import { deleteObjectsReporting } from './storage.service';
import { hashPassword } from './auth.service';
import type { TokenPayload } from '../utils/jwt';

/**
 * Subject access export and erasure (§13, and the GDPR obligations that attach
 * to holding data about children).
 *
 * Two operations that look like opposites and share one requirement: both have
 * to be **provable**. An export that quietly omits a table, or an erasure that
 * reports success while leaving a name somewhere, is worse than not offering
 * the feature — because it will be relied on.
 *
 * The policy these implement is `docs/DATA_RETENTION.md`. The numbers in there
 * still need a lawyer; the *shape* — anonymise rather than delete — does not,
 * and is explained in §3 of that document and again below.
 */

const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

/**
 * Everything held about one person, as JSON.
 *
 * Deliberately assembled table by table rather than through a clever generic
 * walk of the Prisma schema. A generic walk silently gains and loses tables as
 * the schema changes, and the failure mode — an export missing a category
 * nobody noticed — is exactly the one that matters here. This list is checked
 * against the schema by `tests/privacy.test.ts`, which fails when a new
 * user-linked relation appears and is not accounted for.
 */
export const exportUser = async (actor: TokenPayload, userId: string) =>
  withTenant(actor.schoolId!, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        status: true,
        lastLoginAt: true,
        erasedAt: true,
        createdAt: true,
        updatedAt: true,
        // Deliberately absent: passwordHash, twoFactorSecret, twoFactorLastStep.
        // A subject access request is not a credential dump — handing back a
        // bcrypt hash and an encrypted TOTP seed would create a new disclosure
        // risk in the name of transparency, and neither is data the subject
        // can act on.
        school: { select: { schoolCode: true, name: true } },
      },
    });
    if (!user) throw notFound('User not found');

    const [
      enrollments,
      taughtClasses,
      quizAttempts,
      submissions,
      certificates,
      videoProgress,
      videoEvents,
      parentLinks,
      childLinks,
      auditLogs,
    ] = await Promise.all([
      tx.enrollment.findMany({
        where: { studentId: userId },
        select: { enrolledAt: true, class: { select: { name: true, academicYear: true } } },
      }),
      tx.class.findMany({
        where: { teacherId: userId },
        select: { name: true, academicYear: true, createdAt: true },
      }),
      tx.quizAttempt.findMany({
        where: { studentId: userId },
        // The answers, not merely the score. "What did I answer" is precisely
        // the sort of thing a subject access request is for, and a bare mark
        // would be a summary rather than the data held.
        include: { answers: true },
      }),
      tx.assignmentSubmission.findMany({ where: { studentId: userId } }),
      tx.certificate.findMany({ where: { studentId: userId } }),
      tx.videoProgress.findMany({ where: { studentId: userId } }),
      /*
       * The behavioural log, in full.
       *
       * This is the one most likely to be left out — it is by far the largest
       * table and the least interesting to read. It is also the most sensitive
       * thing the product holds: when a particular child watched, paused and
       * rewound, to the second. Omitting it would make the export a
       * misrepresentation. Bounded in practice by the 90-day retention sweep.
       */
      tx.videoEvent.findMany({ where: { studentId: userId }, orderBy: { occurredAt: 'asc' } }),
      tx.parentLink.findMany({
        where: { childId: userId },
        select: { parent: { select: { name: true, email: true } } },
      }),
      tx.parentLink.findMany({
        where: { parentId: userId },
        select: { child: { select: { name: true, email: true } } },
      }),
      // Only entries *about* this person. Entries where they were the actor
      // are excluded on purpose: those describe actions taken against other
      // people's records, and returning them would leak third parties.
      tx.auditLog.findMany({
        where: { entity: 'User', entityId: userId },
        select: { action: true, metadata: true, createdAt: true },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      subject: user,
      enrollments,
      taughtClasses,
      quizAttempts,
      assignmentSubmissions: submissions,
      certificates,
      videoProgress,
      videoEvents,
      parents: parentLinks.map((l) => l.parent),
      children: childLinks.map((l) => l.child),
      auditLog: auditLogs,
      counts: {
        enrollments: enrollments.length,
        taughtClasses: taughtClasses.length,
        quizAttempts: quizAttempts.length,
        assignmentSubmissions: submissions.length,
        certificates: certificates.length,
        videoProgress: videoProgress.length,
        videoEvents: videoEvents.length,
        auditLog: auditLogs.length,
      },
    };
  });

export type ErasureReport = {
  userId: string;
  erasedAt: string;
  overwritten: string[];
  deleted: Record<string, number>;
  retained: Record<string, number>;
  certificates: { revoked: number; untouched: number };
  /**
   * Uploaded files, which live in a bucket rather than in Postgres and so
   * cannot be covered by the transaction. `failed` being non-empty means
   * objects survive that should not; the keys are in the audit log so it can
   * be retried.
   */
  storage: { total: number; deleted: number; failed: number };
  note: string;
};

/**
 * Erases a person by overwriting what identifies them, and reports what it did.
 *
 * **Not a delete, and the difference is the whole design.** A cascade would
 * take the class's history with the pupil: a roster loses a member mid-term, a
 * teacher's marking history acquires holes, and `certificates.student_id` is
 * `ON DELETE RESTRICT` so the statement would simply fail. Academic records are
 * also the category a school is most likely to be *required* to keep. So the
 * row stays and stops being attributable.
 *
 * What is overwritten, and why each one:
 *
 *  - `name`, `email`, `avatarUrl` — the identifiers.
 *  - `passwordHash` — replaced with a hash of fresh random bytes rather than
 *    emptied. An empty or null hash is a value some future comparison might
 *    treat as a match; an unknown one cannot be guessed and fails closed.
 *  - `twoFactorSecret`, `twoFactorEnabledAt`, `twoFactorLastStep` — the seed is
 *    a password equivalent and has no reason to outlive the account.
 *  - `tokenVersion` — incremented, which invalidates every access token already
 *    in flight. Without this the person stays signed in on their own device
 *    after being erased.
 *  - `status` — INACTIVE, so nothing treats the tombstone as a live account.
 *
 * Refresh tokens, recovery codes and reset tokens are **deleted** rather than
 * overwritten: they authorise access and retain nothing of value.
 *
 * `video_events` is deliberately *not* deleted — DELETE on that table is
 * revoked from the application role to keep it append-only, and the rows are
 * pseudonymous once the user row is anonymised. The 90-day retention sweep
 * removes them on its own schedule.
 */
export const eraseUser = async (
  actor: TokenPayload,
  userId: string,
  options: { revokeCertificates?: boolean; reason?: string } = {}
): Promise<ErasureReport> =>
  withTenant(actor.schoolId!, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, erasedAt: true, schoolId: true },
    });
    if (!user) throw notFound('User not found');

    // Erasing yourself would leave the school with one fewer administrator and
    // an actor id on the audit entry that no longer resolves to anyone. If a
    // school admin is to be erased, another one must do it.
    if (userId === actor.userId) {
      throw badRequest('You cannot erase your own account');
    }

    if (user.erasedAt) {
      throw conflict('This account has already been erased');
    }

    /*
     * Certificates are the documented exception, and the caller has to choose.
     *
     * A certificate carries a *denormalised* `studentName` precisely so the
     * credential still means something years later — which is exactly what
     * makes it survive an erasure. Two honest options: revoke the credential,
     * or accept that the name persists. `DATA_RETENTION.md` §3 says this is a
     * decision to make explicitly with the school, so the endpoint refuses to
     * make it silently in either direction.
     */
    const live = await tx.certificate.count({ where: { studentId: userId, revokedAt: null } });
    if (live > 0 && options.revokeCertificates === undefined) {
      throw Object.assign(
        new Error(
          `This person holds ${live} live certificate${live === 1 ? '' : 's'}, which carry their ` +
            'name so that the credential can be verified. Decide explicitly: pass ' +
            'revokeCertificates=true to revoke them (the public verifier will report the ' +
            'revocation), or revokeCertificates=false to keep them valid and accept that the ' +
            'name persists.'
        ),
        { statusCode: 409 }
      );
    }

    let revoked = 0;
    if (live > 0 && options.revokeCertificates) {
      const result = await tx.certificate.updateMany({
        where: { studentId: userId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokeReason: options.reason ?? 'Erasure request by the data subject',
        },
      });
      revoked = result.count;
    }

    const [refreshTokens, recoveryCodes, resetTokens] = await Promise.all([
      tx.refreshToken.deleteMany({ where: { userId } }),
      tx.recoveryCode.deleteMany({ where: { userId } }),
      tx.passwordResetToken.deleteMany({ where: { userId } }),
    ]);

    /*
     * Uploaded coursework.
     *
     * The mark and the feedback are columns on the submission row and are
     * retained — those are the academic record. The *file* is the pupil's own
     * content and can identify them directly whatever name is on the row: an
     * essay signs itself, a photo shows a face. Leaving it in the bucket while
     * reporting the person erased would be the assurance without the act.
     *
     * The keys are collected and the columns nulled here, inside the
     * transaction, but the objects themselves are deleted **after** it
     * commits. Object storage is not transactional: deleting first and then
     * rolling back would destroy a pupil's work without erasing them, which is
     * strictly the worst of both outcomes.
     */
    const withFiles = await tx.assignmentSubmission.findMany({
      where: { studentId: userId, fileKey: { not: null } },
      select: { fileKey: true },
    });
    const fileKeys = withFiles.map((s) => s.fileKey!).filter(Boolean);

    if (fileKeys.length > 0) {
      await tx.assignmentSubmission.updateMany({
        where: { studentId: userId },
        data: { fileKey: null },
      });
    }

    const erasedAt = new Date();

    /*
     * The placeholder address.
     *
     * `.invalid` is reserved by RFC 2606 and can never be delivered to, so a
     * stray notification cannot reach a real person. The user id keeps it
     * unique, which matters because `@@unique([schoolId, email])` would
     * otherwise reject the second erasure in a school.
     */
    await tx.user.update({
      where: { id: userId },
      data: {
        name: 'Erased user',
        email: `erased+${userId}@erased.invalid`,
        avatarUrl: null,
        passwordHash: await hashPassword(crypto.randomBytes(32).toString('base64url')),
        twoFactorSecret: null,
        twoFactorEnabledAt: null,
        twoFactorLastStep: null,
        tokenVersion: { increment: 1 },
        status: 'INACTIVE',
        erasedAt,
      },
    });

    const [quizAttempts, submissions, certificates, videoProgress, videoEvents, enrollments] =
      await Promise.all([
        tx.quizAttempt.count({ where: { studentId: userId } }),
        tx.assignmentSubmission.count({ where: { studentId: userId } }),
        tx.certificate.count({ where: { studentId: userId } }),
        tx.videoProgress.count({ where: { studentId: userId } }),
        tx.videoEvent.count({ where: { studentId: userId } }),
        tx.enrollment.count({ where: { studentId: userId } }),
      ]);

    const report: ErasureReport = {
      userId,
      erasedAt: erasedAt.toISOString(),
      overwritten: [
        'name',
        'email',
        'avatarUrl',
        'passwordHash',
        'twoFactorSecret',
        'twoFactorEnabledAt',
        'twoFactorLastStep',
      ],
      deleted: {
        refreshTokens: refreshTokens.count,
        recoveryCodes: recoveryCodes.count,
        passwordResetTokens: resetTokens.count,
      },
      retained: {
        enrollments,
        quizAttempts,
        assignmentSubmissions: submissions,
        certificates,
        videoProgress,
        videoEvents,
      },
      certificates: { revoked, untouched: certificates - revoked },
      // Filled in after the transaction commits; see below.
      storage: { total: fileKeys.length, deleted: 0, failed: fileKeys.length },
      note:
        'Academic records are retained as unattributable rows. video_events are pseudonymous ' +
        'and age out under the 90-day retention sweep; they cannot be deleted here because ' +
        'DELETE is revoked from the application role to keep the table append-only.',
    };

    // The report is the proof, so it is stored rather than only returned. A
    // caller that loses the response must still be able to show what happened.
    await tx.auditLog.create({
      data: {
        schoolId: actor.schoolId!,
        actorId: actor.userId,
        action: 'USER_ERASED',
        entity: 'User',
        entityId: userId,
        // fileKeys are recorded so a failed object deletion can be retried.
        // Once the columns are nulled above, the audit log is the only place
        // that still knows which objects belonged to this person.
        metadata: { ...report, roleAtErasure: user.role, fileKeys },
      },
    });

    return { report, fileKeys };
  }).then(async ({ report, fileKeys }) => {
    /*
     * Phase two, outside the transaction.
     *
     * Everything above is committed by this point: the person is erased
     * whatever happens next. What remains is removing the objects, and the
     * only honest thing to do about a failure is to say so — hence the counts
     * in the report and a second audit entry naming the keys that survived.
     *
     * Deliberately not rolled back on failure. Re-attaching the file keys to
     * make the two consistent would un-erase somebody because a bucket was
     * briefly unreachable, and would leave the operator believing the request
     * had not been actioned at all.
     */
    const { deleted, failed } = await deleteObjectsReporting(fileKeys);
    report.storage = { total: fileKeys.length, deleted: deleted.length, failed: failed.length };

    if (failed.length > 0) {
      report.note +=
        ` WARNING: ${failed.length} uploaded file(s) could not be deleted from object storage ` +
        'and still exist. The keys are in the USER_ERASED_STORAGE audit entry; retry before ' +
        'treating this erasure as complete.';

      await withTenant(actor.schoolId!, (tx) =>
        tx.auditLog.create({
          data: {
            schoolId: actor.schoolId!,
            actorId: actor.userId,
            action: 'USER_ERASED_STORAGE',
            entity: 'User',
            entityId: userId,
            metadata: { deleted: deleted.length, failed: failed.length, failedKeys: failed },
          },
        })
      );
    }

    return report;
  });
