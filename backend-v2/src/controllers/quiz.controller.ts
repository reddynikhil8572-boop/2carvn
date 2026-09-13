import { Request, Response, NextFunction } from 'express';
import * as quizService from '../services/quiz.service';
import { successResponse } from '../utils/responseFormat';

/** Requirements §12. Thin, like course.controller.ts — the rules live in the service. */

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

export const getQuiz = handler(
  (req) => quizService.getQuiz(req.user!, idOf(req)),
  200,
  'Quiz fetched'
);

export const updateQuiz = handler(
  (req) => quizService.updateQuiz(req.user!, idOf(req), req.body),
  200,
  'Quiz updated'
);

export const createQuestion = handler(
  (req) => quizService.createQuestion(req.user!, idOf(req), req.body),
  201,
  'Question added'
);

export const startAttempt = handler(
  (req) => quizService.startAttempt(req.user!, idOf(req)),
  201,
  'Attempt started'
);

export const listAttempts = handler(
  (req) => quizService.listAttempts(req.user!, idOf(req)),
  200,
  'Attempts fetched'
);

export const submitAttempt = handler(
  (req) => quizService.submitAttempt(req.user!, idOf(req), req.body),
  200,
  'Attempt submitted'
);

export const getAttempt = handler(
  (req) => quizService.getAttempt(req.user!, idOf(req)),
  200,
  'Attempt fetched'
);
