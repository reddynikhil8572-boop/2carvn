import { Request, Response, NextFunction } from 'express';
import * as courseService from '../services/course.service';
import * as itemService from '../services/lessonItem.service';
import { successResponse } from '../utils/responseFormat';

/**
 * Requirements §6. Thin controllers: every authorization and ordering decision
 * lives in the services, so an endpoint added later cannot accidentally use a
 * looser rule than the one beside it.
 */

/**
 * Express 5 types route params as `string | string[]`, since a pattern can
 * repeat a name. Ours cannot, and validateParams(idParamSchema) has already
 * proved this one is a uuid — so the narrowing is safe, and doing it in one
 * place keeps the cast out of every handler.
 */
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

export const createCourse = handler(
  (req) => courseService.createCourse(req.user!, req.body),
  201,
  'Course created'
);

export const listCourses = handler(
  (req) => courseService.listCourses(req.user!),
  200,
  'Courses fetched'
);

export const getCourse = handler(
  (req) => courseService.getCourseTree(req.user!, idOf(req)),
  200,
  'Course fetched'
);

export const updateCourse = handler(
  (req) => courseService.updateCourse(req.user!, idOf(req), req.body),
  200,
  'Course updated'
);

export const createModule = handler(
  (req) => courseService.createModule(req.user!, idOf(req), req.body),
  201,
  'Module created'
);

export const createChapter = handler(
  (req) => courseService.createChapter(req.user!, idOf(req), req.body),
  201,
  'Chapter created'
);

export const createLesson = handler(
  (req) => courseService.createLesson(req.user!, idOf(req), req.body),
  201,
  'Lesson created'
);

export const assignClass = handler(
  (req) => courseService.assignCourseToClass(req.user!, idOf(req), req.body.classId),
  201,
  'Course assigned to class'
);

export const createLessonItem = handler(
  (req) => itemService.createLessonItem(req.user!, idOf(req), req.body),
  201,
  'Lesson item created'
);

export const updateLessonItem = handler(
  (req) => itemService.updateLessonItem(req.user!, idOf(req), req.body),
  200,
  'Lesson item updated'
);

export const reorderLessonItems = handler(
  (req) => itemService.reorderLessonItems(req.user!, idOf(req), req.body.itemIds),
  200,
  'Lesson items reordered'
);
