import { Request, Response, NextFunction } from 'express';
import * as service from '../services/upload.service';
import { successResponse } from '../utils/responseFormat';

/** Object storage endpoints. Thin, like the other §6 controllers. */

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

export const presignVideoUpload = handler(
  (req) => service.presignVideoUpload(req.user!, idOf(req), req.body),
  200,
  'Upload authorised'
);

export const confirmVideoUpload = handler(
  (req) => service.confirmVideoUpload(req.user!, idOf(req), req.body),
  200,
  'Video attached'
);

export const getVideoUrl = handler(
  (req) => service.getVideoUrl(req.user!, idOf(req)),
  200,
  'Video URL issued'
);

export const presignSubmissionUpload = handler(
  (req) => service.presignSubmissionUpload(req.user!, idOf(req), req.body),
  200,
  'Upload authorised'
);

export const getSubmissionFileUrl = handler(
  (req) => service.getSubmissionFileUrl(req.user!, idOf(req)),
  200,
  'File URL issued'
);

export const presignCoverUpload = handler(
  (req) => service.presignCoverUpload(req.user!, idOf(req), req.body),
  200,
  'Upload authorised'
);

export const confirmCoverUpload = handler(
  (req) => service.confirmCoverUpload(req.user!, idOf(req), req.body.key),
  200,
  'Cover image attached'
);

export const getCoverUrl = handler(
  (req) => service.getCoverUrl(req.user!, idOf(req)),
  200,
  'Cover URL issued'
);
