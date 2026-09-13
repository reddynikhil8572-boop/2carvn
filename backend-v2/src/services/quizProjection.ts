import type { TokenPayload } from '../utils/jwt';
import { isStaff } from './courseAccess';

/**
 * What a quiz looks like to each audience.
 *
 * This file exists for one reason: **`quiz_options.is_correct` must never
 * reach a student.**
 *
 * That was hard to get wrong under Mongoose, where leaking it took an explicit
 * `.select()`. Under Prisma it is the *default*: a perfectly reasonable-looking
 *
 *     include: { questions: { include: { options: true } } }
 *
 * returns every correct answer, and it reads fine in review. The mitigation is
 * to make the safe path the only path — no student-facing query anywhere in
 * the codebase composes its own include for a quiz; they all take
 * `quizSelectFor(user)` from here.
 *
 * `tests/quizzes.test.ts` asserts on the serialised response body, at any
 * depth, rather than on the shape of an object. A projection that is correct
 * in principle and bypassed in one handler still ships the bug.
 */

const BY_POSITION = [{ position: 'asc' as const }, { createdAt: 'asc' as const }];

/** Options as a student may see them. Note the absence of `isCorrect`. */
const studentOptionSelect = {
  select: { id: true, text: true, position: true },
  orderBy: BY_POSITION,
} as const;

/** Options as staff may see them, correct flags included. */
const staffOptionSelect = {
  select: { id: true, text: true, position: true, isCorrect: true },
  orderBy: BY_POSITION,
} as const;

const questionSelect = (forStaff: boolean) =>
  ({
    select: {
      id: true,
      prompt: true,
      position: true,
      points: true,
      options: forStaff ? staffOptionSelect : studentOptionSelect,
    },
    orderBy: BY_POSITION,
  }) as const;

const quizSelect = (forStaff: boolean) =>
  ({
    select: {
      lessonItemId: true,
      instructions: true,
      passingScore: true,
      timeLimitMinutes: true,
      maxAttempts: true,
      shuffleQuestions: true,
      questions: questionSelect(forStaff),
    },
  }) as const;

/**
 * The only sanctioned way to read a quiz for a caller. Anything that needs a
 * quiz in a response body goes through this.
 */
export const quizSelectFor = (user: TokenPayload) => quizSelect(isStaff(user.role));

/**
 * Grading reads correct answers through this, never through a request-shaped
 * projection. Separating them means a change to what students see cannot
 * silently change what the grader compares against — and vice versa.
 *
 * The result of this is used to compute a score and is never serialised into a
 * response.
 */
export const gradingSelect = {
  select: {
    id: true,
    points: true,
    options: { select: { id: true, isCorrect: true } },
  },
} as const;
