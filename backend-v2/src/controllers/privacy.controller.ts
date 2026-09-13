import { Request, Response, NextFunction } from 'express';
import { eraseUser, exportUser } from '../services/privacy.service';
import { successResponse } from '../utils/responseFormat';
import { logger } from '../utils/logger';

/**
 * GET /api/v1/school-admin/users/:id/export
 *
 * Everything held about one person. Staff-only and tenant-scoped: RLS makes a
 * user in another school invisible, so the lookup 404s rather than 403s — the
 * same convention the rest of the API uses, so that the existence of an
 * account elsewhere is not disclosed.
 */
export const exportUserData = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await exportUser(req.user!, String(req.params.id));

    // Logged because a subject access export is itself a disclosure of
    // personal data, and "who pulled a full copy of this child's record, and
    // when" is a question worth being able to answer.
    logger.info(
      `Subject access export: user ${req.params.id} by ${req.user!.userId} ` +
        `(${data.counts.videoEvents} video events, ${data.counts.quizAttempts} attempts)`
    );

    res
      .status(200)
      .setHeader('Content-Disposition', `attachment; filename="export-${req.params.id}.json"`)
      .json(successResponse(data, 'Export generated'));
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/school-admin/users/:id
 *
 * Erasure by anonymisation. Returns a report of what was overwritten, deleted
 * and retained, because erasure has to be provable rather than asserted — see
 * `services/privacy.service.ts`.
 *
 * `revokeCertificates` is read from the query string rather than a body: DELETE
 * bodies are legal but poorly supported by proxies and clients, and this is a
 * single flag. It is deliberately **tri-state** — absent means "you have not
 * decided yet" and produces a 409 explaining the choice, rather than a default
 * that quietly picks one side of a decision the school is supposed to make.
 */
export const eraseUserData = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const raw = req.query.revokeCertificates;
    let revokeCertificates: boolean | undefined;
    if (raw === 'true') revokeCertificates = true;
    else if (raw === 'false') revokeCertificates = false;
    else if (raw !== undefined) {
      throw Object.assign(new Error('revokeCertificates must be "true" or "false"'), {
        statusCode: 422,
      });
    }

    const reason = typeof req.query.reason === 'string' ? req.query.reason : undefined;

    const report = await eraseUser(req.user!, String(req.params.id), { revokeCertificates, reason });

    logger.info(
      `Erasure: user ${req.params.id} by ${req.user!.userId}; ` +
        `${report.certificates.revoked} certificates revoked, ` +
        `${report.retained.quizAttempts} attempts retained`
    );

    res.status(200).json(successResponse(report, 'Account erased'));
  } catch (error) {
    next(error);
  }
};
