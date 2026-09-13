import { Request, Response, NextFunction } from 'express';
import * as service from '../services/video.service';
import { successResponse } from '../utils/responseFormat';

/** Requirements §7 and §8 — video tracking and its roll-up. */

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

export const recordHeartbeat = handler(
  (req) => service.recordHeartbeat(req.user!, idOf(req), req.body),
  200,
  'Progress recorded'
);

export const getOwnProgress = handler(
  (req) => service.getOwnProgress(req.user!, idOf(req)),
  200,
  'Progress fetched'
);

export const listProgressForItem = handler(
  (req) => service.listProgressForItem(req.user!, idOf(req)),
  200,
  'Class progress fetched'
);

export const courseVideoAnalytics = handler(
  (req) => service.courseVideoAnalytics(req.user!, idOf(req)),
  200,
  'Analytics fetched'
);
