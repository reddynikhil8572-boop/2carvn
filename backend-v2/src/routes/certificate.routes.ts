import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/certificate.controller';
import { requireAuth, requireRole, requireTenant } from '../middlewares/auth';
import { validate, validateParams } from '../middlewares/validate';

/**
 * Requirements §10 — certificates.
 *
 * Two audiences on one resource, so the routers are separated by whether they
 * require a session at all. Keeping the public pair in their own router makes
 * it impossible to add an authenticated route beside them by accident.
 */

const serialParamSchema = z.object({
  /// Matches the issued shape (EDU-XXXX-XXXX-XXXX) and nothing else, so the
  /// unauthenticated handler never sees arbitrary input. `.pdf` is allowed as
  /// a suffix for the download route.
  serial: z.string().regex(/^EDU-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}(\.pdf)?$/i, 'Invalid serial'),
});

const issueSchema = z.object({ studentId: z.string().uuid('Invalid student id') }).strict();
const revokeSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

/**
 * PUBLIC. No requireAuth anywhere in this router — that is the point of it.
 *
 * These are the only routes in the system that read tenant data with no
 * session, which is why the service goes through a narrow SECURITY DEFINER
 * function rather than the ordinary client. See certificate.service.ts.
 */
export const publicCertificateRouter = Router();

publicCertificateRouter.get(
  '/:serial',
  validateParams(serialParamSchema),
  ctrl.verifyCertificate
);

publicCertificateRouter.get(
  '/:serial/download',
  validateParams(serialParamSchema),
  ctrl.downloadCertificate
);

/** Authenticated: issuing, listing and revoking. */
export const certificateAdminRouter = Router();

const staffOnly = [requireAuth, requireTenant, requireRole(['SCHOOL_ADMIN', 'TEACHER'])] as const;

certificateAdminRouter.post(
  '/:serial/revoke',
  ...staffOnly,
  validateParams(serialParamSchema),
  validate(revokeSchema),
  ctrl.revokeCertificate
);

/** Issuing and listing are course-scoped, so they live on the course router. */
export { issueSchema, staffOnly as certificateStaffGuard };
