import { Request, Response, NextFunction } from 'express';
import * as service from '../services/assignment.service';
import { successResponse } from '../utils/responseFormat';

/** Requirements §12 — assignments. Thin, like the other §6 controllers. */

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

export const getAssignment = handler(
  (req) => service.getAssignment(req.user!, idOf(req)),
  200,
  'Assignment fetched'
);

export const updateAssignment = handler(
  (req) => service.updateAssignment(req.user!, idOf(req), req.body),
  200,
  'Assignment updated'
);

export const submitAssignment = handler(
  (req) => service.submitAssignment(req.user!, idOf(req), req.body),
  201,
  'Assignment submitted'
);

export const getSubmission = handler(
  (req) => service.getSubmission(req.user!, idOf(req)),
  200,
  'Submission fetched'
);

export const gradeSubmission = handler(
  (req) => service.gradeSubmission(req.user!, idOf(req), req.body),
  200,
  'Submission graded'
);
