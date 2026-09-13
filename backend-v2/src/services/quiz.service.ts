import { Prisma } from '@prisma/client';
import { withTenant } from '../db/tenantContext';
import {
  findEditableCourseForLessonItem,
  findReadableCourseForLessonItem,
  isStaff,
} from './courseAccess';
import { gradingSelect, quizSelectFor } from './quizProjection';
import type { TokenPayload } from '../utils/jwt';
import type { CreateQuestionInput, SubmitAttemptInput, UpdateQuizInput } from '../validators/quiz.validator';

/**
 * Requirements §12 — quizzes, attempts and auto-grading.
 *
 * The scoring shape is carried over from the previous backend, which computed
 * scores server-side from stored answers and never trusted a client-supplied
 * result. Three of its behaviours are deliberately NOT carried over; each is
 * marked below with the flaw it fixes.
 */

const notFound = (m: string) => Object.assign(new Error(m), { statusCode: 404 });
const forbidden = (m: string) => Object.assign(new Error(m), { statusCode: 403 });
const conflict = (m: string) => Object.assign(new Error(m), { statusCode: 409 });
const badRequest = (m: string) => Object.assign(new Error(m), { statusCode: 400 });

// ── Authoring ──────────────────────────────────────────────────────────────

export const updateQuiz = async (user: TokenPayload, itemId: string, input: UpdateQuizInput) =>
  withTenant(user.schoolId!, async (tx) => {
    await findEditableCourseForLessonItem(tx, itemId, user);

    const quiz = await tx.quiz.findUnique({ where: { lessonItemId: itemId } });
    if (!quiz) throw notFound('Quiz not found');

    return tx.quiz.update({
      where: { lessonItemId: itemId },
      data: {
        instructions: input.instructions,
        passingScore: input.passingScore,
        timeLimitMinutes: input.timeLimitMinutes,
        maxAttempts: input.maxAttempts,
        shuffleQuestions: input.shuffleQuestions,
      },
    });
  });

/**
 * Adds a question and its options in one transaction.
 *
 * A question with no correct option can never be answered correctly and would
 * silently drag every score down, so it is rejected rather than stored. The
 * validator enforces the same rule; this is the service refusing to depend on
 * having been called through it.
 */
export const createQuestion = async (
  user: TokenPayload,
  itemId: string,
  input: CreateQuestionInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findEditableCourseForLessonItem(tx, itemId, user);

    const quiz = await tx.quiz.findUnique({ where: { lessonItemId: itemId } });
    if (!quiz) throw notFound('Quiz not found');

    if (!input.options.some((option) => option.isCorrect)) {
      throw badRequest('A question must have at least one correct option');
    }

    const last = await tx.quizQuestion.findFirst({
      where: { quizId: itemId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return tx.quizQuestion.create({
      data: {
        schoolId: user.schoolId!,
        quizId: itemId,
        prompt: input.prompt,
        points: input.points ?? 1,
        position: last ? last.position + 1 : 0,
        options: {
          create: input.options.map((option, index) => ({
            schoolId: user.schoolId!,
            text: option.text,
            isCorrect: option.isCorrect,
            position: index,
          })),
        },
      },
      include: { options: { orderBy: { position: 'asc' } } },
    });
  });

/**
 * Reads a quiz for whoever is asking — correct answers included for staff,
 * absent for students. See services/quizProjection.ts.
 */
export const getQuiz = async (user: TokenPayload, itemId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    // Resolves up to the course and applies the read rules there. Checking
    // only `is_published` on the item would let a student open any released
    // quiz in their school by id, including from a course assigned to a
    // different class.
    await findReadableCourseForLessonItem(tx, itemId, user);

    const quiz = await tx.quiz.findUnique({
      where: { lessonItemId: itemId },
      ...quizSelectFor(user),
    });
    if (!quiz) throw notFound('Quiz not found');

    return quiz;
  });

// ── Attempts ───────────────────────────────────────────────────────────────

/**
 * Starts an attempt.
 *
 * **Fix 1 — the timer is no longer client-controlled.** The previous
 * implementation read `startedAt` from the request body at submission time, so
 * a client sending the current timestamp had an unlimited window and the check
 * was decoration. Here the server creates the row, stamps `started_at`, and
 * derives `expires_at` from the quiz's own time limit. The client never
 * supplies a time and never can.
 *
 * **Fix 2 — the attempt limit no longer races.** The previous implementation
 * counted existing submissions and then inserted, so two concurrent requests
 * both saw `count = max - 1` and both succeeded. The row is now created up
 * front carrying `attempt_number`, under
 * `unique (quiz_id, student_id, attempt_number)`: exceeding the limit is a
 * constraint violation, not a check that can be outrun.
 */
export const startAttempt = async (user: TokenPayload, itemId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    await findReadableCourseForLessonItem(tx, itemId, user);

    const quiz = await tx.quiz.findUnique({ where: { lessonItemId: itemId } });
    if (!quiz) throw notFound('Quiz not found');

    // An attempt already open is resumed rather than replaced, so a refreshed
    // browser does not burn one.
    const open = await tx.quizAttempt.findFirst({
      where: { quizId: itemId, studentId: user.userId, status: 'IN_PROGRESS' },
    });
    if (open) {
      if (open.expiresAt && open.expiresAt.getTime() <= Date.now()) {
        await tx.quizAttempt.update({
          where: { id: open.id },
          data: { status: 'EXPIRED' },
        });
      } else {
        return open;
      }
    }

    const used = await tx.quizAttempt.count({
      where: { quizId: itemId, studentId: user.userId },
    });
    if (used >= quiz.maxAttempts) {
      throw conflict(`No attempts remaining (limit ${quiz.maxAttempts})`);
    }

    const startedAt = new Date();
    const expiresAt = quiz.timeLimitMinutes
      ? new Date(startedAt.getTime() + quiz.timeLimitMinutes * 60_000)
      : null;

    try {
      return await tx.quizAttempt.create({
        data: {
          schoolId: user.schoolId!,
          quizId: itemId,
          studentId: user.userId,
          attemptNumber: used + 1,
          startedAt,
          expiresAt,
        },
      });
    } catch (error) {
      // The count above is a friendly message; THIS is the actual limit. A
      // concurrent request that also read `used` has already taken this
      // number, and exactly one of the two survives.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('Another attempt was started at the same time; please try again');
      }
      throw error;
    }
  });

/**
 * Grades and closes an attempt.
 *
 * Scoring reads correct answers through `gradingSelect`, a server-only
 * projection that is never serialised into a response — so a change to what
 * students see cannot quietly change what the grader compares against.
 */
export const submitAttempt = async (
  user: TokenPayload,
  attemptId: string,
  input: SubmitAttemptInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    const attempt = await tx.quizAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw notFound('Attempt not found');

    // Owner-only. RLS put us in the right school; it says nothing about which
    // pupil this belongs to.
    if (attempt.studentId !== user.userId) throw forbidden('This is not your attempt');
    if (attempt.status !== 'IN_PROGRESS') throw conflict('This attempt has already been submitted');

    // The window is judged against the STORED expiry, never against anything
    // the client sends.
    const expired = attempt.expiresAt !== null && attempt.expiresAt.getTime() < Date.now();

    const questions = await tx.quizQuestion.findMany({
      where: { quizId: attempt.quizId },
      ...gradingSelect,
    });
    const quiz = await tx.quiz.findUnique({ where: { lessonItemId: attempt.quizId } });

    const byQuestion = new Map(questions.map((q) => [q.id, q]));

    // Reject answers that do not belong to this quiz outright, rather than
    // ignoring them: a client sending them is either broken or probing, and
    // silently accepting a submission that was partly discarded is worse than
    // refusing it.
    for (const answer of input.answers) {
      const question = byQuestion.get(answer.questionId);
      if (!question) throw badRequest('An answer refers to a question outside this quiz');
      if (!question.options.some((option) => option.id === answer.selectedOptionId)) {
        throw badRequest('An answer refers to an option outside its question');
      }
    }

    const pointsPossible = questions.reduce((sum, q) => sum + q.points, 0);
    let pointsEarned = 0;

    for (const answer of input.answers) {
      const question = byQuestion.get(answer.questionId)!;
      const chosen = question.options.find((option) => option.id === answer.selectedOptionId)!;
      if (chosen.isCorrect) pointsEarned += question.points;
    }

    // An expired attempt is still graded on what was saved, and recorded as
    // EXPIRED so a teacher can tell the difference. Discarding the work would
    // punish a slow connection as though it were a blank paper.
    const percent = pointsPossible === 0 ? 0 : Math.round((pointsEarned / pointsPossible) * 100);

    await tx.quizAnswer.deleteMany({ where: { attemptId } });
    if (input.answers.length > 0) {
      await tx.quizAnswer.createMany({
        data: input.answers.map((answer) => ({
          schoolId: user.schoolId!,
          attemptId,
          questionId: answer.questionId,
          selectedOptionId: answer.selectedOptionId,
        })),
      });
    }

    return tx.quizAttempt.update({
      where: { id: attemptId },
      data: {
        status: expired ? 'EXPIRED' : 'SUBMITTED',
        submittedAt: new Date(),
        pointsEarned,
        pointsPossible,
        passed: percent >= (quiz?.passingScore ?? 60),
        // Advisory only. Recorded for a teacher to look at; never used to fail
        // a submission, because the client is reporting on itself.
        integrityFlags: (input.integrityFlags as Prisma.InputJsonValue) ?? Prisma.DbNull,
      },
    });
  });

/**
 * Reads an attempt. A student may read their own; staff may read any in their
 * school, which is what makes marking possible.
 */
export const getAttempt = async (user: TokenPayload, attemptId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    const attempt = await tx.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        answers: { select: { questionId: true, selectedOptionId: true } },
        student: { select: { id: true, name: true } },
      },
    });
    if (!attempt) throw notFound('Attempt not found');

    if (!isStaff(user.role) && attempt.studentId !== user.userId) {
      throw notFound('Attempt not found');
    }

    return attempt;
  });

/** A student's own attempts at one quiz, or every attempt if staff. */
export const listAttempts = async (user: TokenPayload, itemId: string) =>
  withTenant(user.schoolId!, (tx) =>
    tx.quizAttempt.findMany({
      where: {
        quizId: itemId,
        ...(isStaff(user.role) ? {} : { studentId: user.userId }),
      },
      orderBy: { attemptNumber: 'asc' },
      include: { student: { select: { id: true, name: true } } },
    })
  );

/** Exported for the expiry path in tests and future scheduled sweeps. */
export const expireStaleAttempts = async (schoolId: string) =>
  withTenant(schoolId, (tx) =>
    tx.quizAttempt.updateMany({
      where: { status: 'IN_PROGRESS', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    })
  );
