import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import * as service from '../services/class.service';
import { requireAuth, requireRole, requireTenant } from '../middlewares/auth';
import { validate, validateParams } from '../middlewares/validate';
import { successResponse } from '../utils/responseFormat';
import { createClassSchema, enrolSchema } from '../validators/class.validator';
import { idParamSchema } from '../validators/course.validator';

/**
 * Requirements §2 — classes and enrolment.
 *
 * Reading is open to any role in the school: a teacher needs the list to
 * attach a course to a class. Writing is school-admin only — deciding who is
 * in which class is an administrative act, not a teaching one.
 */

const router = Router();

const idOf = (req: Request): string => String(req.params.id);

const handler =
  (fn: (req: Request) => Promise<unknown>, status: number, message: string) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(status).json(successResponse(await fn(req), message));
    } catch (error) {
      next(error);
    }
  };

const tenant = () => [requireAuth, requireTenant] as const;
const adminOnly = requireRole(['SCHOOL_ADMIN']);

router.get(
  '/',
  ...tenant(),
  handler((req) => service.listClasses(req.user!), 200, 'Classes fetched')
);

router.post(
  '/',
  ...tenant(),
  adminOnly,
  validate(createClassSchema),
  handler((req) => service.createClass(req.user!, req.body), 201, 'Class created')
);

router.get(
  '/:id/enrollments',
  ...tenant(),
  validateParams(idParamSchema),
  handler((req) => service.listEnrollments(req.user!, idOf(req)), 200, 'Enrollments fetched')
);

router.post(
  '/:id/enrollments',
  ...tenant(),
  adminOnly,
  validateParams(idParamSchema),
  validate(enrolSchema),
  handler((req) => service.enrolStudent(req.user!, idOf(req), req.body), 201, 'Student enrolled')
);

export default router;
