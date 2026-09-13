import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin, withTenant } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';

/**
 * Requirements §12 — quizzes, attempts and auto-grading.
 *
 * Four of these tests exist because of specific defects, not for coverage:
 * the correct-answer leak (§6.2 of the design), the client-controlled timer
 * and the racy attempt count (§5.2 flaws 1 and 2), and the composite foreign
 * key that makes a cross-question answer unrepresentable (§6.3).
 */

const PASSWORD = 'Passw0rd!x';
const SCHOOL = 'QZ-A';

const ids = {
  school: '',
  klass: '',
  teacher: '',
  student: '',
  courseId: '',
  lessonId: '',
  quizItemId: '',
  questionIds: [] as string[],
};

const teacherEmail = `teacher@${SCHOOL.toLowerCase()}.test`;
const studentEmail = `student@${SCHOOL.toLowerCase()}.test`;

const signIn = async (email: string) => {
  const a = request.agent(app);
  const res = await a
    .post('/api/v1/auth/login')
    .send({ schoolCode: SCHOOL, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${res.text}`).toBe(200);
  return a;
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);

  const school = await asSuperAdmin((tx) =>
    tx.school.create({
      data: { schoolCode: SCHOOL, name: 'Quiz Academy', plan: 'STANDARD', studentCap: 2000 },
    })
  );
  ids.school = school.id;

  await withTenant(school.id, async (tx) => {
    const teacher = await tx.user.create({
      data: { schoolId: school.id, email: teacherEmail, passwordHash, name: 'T', role: 'TEACHER' },
    });
    const student = await tx.user.create({
      data: { schoolId: school.id, email: studentEmail, passwordHash, name: 'S', role: 'STUDENT' },
    });
    const klass = await tx.class.create({
      data: { schoolId: school.id, name: 'Y1', academicYear: '2026', teacherId: teacher.id },
    });
    await tx.enrollment.create({
      data: { schoolId: school.id, classId: klass.id, studentId: student.id },
    });

    ids.teacher = teacher.id;
    ids.student = student.id;
    ids.klass = klass.id;
  });

  // Build a published course containing one published quiz item.
  const teacher = await signIn(teacherEmail);

  const course = await teacher.post('/api/v1/courses').send({ title: 'Physics' });
  ids.courseId = course.body.data.id;

  const tree = await teacher.get(`/api/v1/courses/${ids.courseId}`);
  const chapterId = tree.body.data.modules[0].chapters[0].id;

  const lesson = await teacher
    .post(`/api/v1/chapters/${chapterId}/lessons`)
    .send({ title: 'Motion' });
  ids.lessonId = lesson.body.data.id;

  const item = await teacher.post(`/api/v1/lessons/${ids.lessonId}/items`).send({
    kind: 'QUIZ',
    title: 'Motion check',
    isPublished: true,
    passingScore: 50,
    maxAttempts: 2,
  });
  expect(item.status, item.text).toBe(201);
  ids.quizItemId = item.body.data.id;

  for (const [prompt, right] of [
    ['What is velocity?', 'Speed with direction'],
    ['Unit of force?', 'Newton'],
  ] as const) {
    const q = await teacher.post(`/api/v1/items/${ids.quizItemId}/questions`).send({
      prompt,
      points: 1,
      options: [
        { text: right, isCorrect: true },
        { text: 'Something else', isCorrect: false },
      ],
    });
    expect(q.status, q.text).toBe(201);
    ids.questionIds.push(q.body.data.id);
  }

  await teacher.patch(`/api/v1/courses/${ids.courseId}`).send({ status: 'PUBLISHED' });
  await teacher.post(`/api/v1/courses/${ids.courseId}/classes`).send({ classId: ids.klass });
});

afterAll(async () => {
  await asSuperAdmin((tx) => tx.school.deleteMany({ where: { schoolCode: SCHOOL } }));
  await prisma.$disconnect();
});

describe('the correct-answer leak', () => {
  /**
   * Asserted against the SERIALISED body, at any depth, rather than against
   * the shape of an object. A projection that is right in principle and
   * bypassed by one handler still ships the bug, and only the wire format
   * catches that.
   */
  const assertNoCorrectFlags = (body: unknown, where: string) => {
    const serialised = JSON.stringify(body);
    expect(serialised, `${where} leaked isCorrect`).not.toMatch(/isCorrect/i);
    expect(serialised, `${where} leaked is_correct`).not.toMatch(/is_correct/i);
  };

  it('does not send correct answers to a student reading the quiz', async () => {
    const student = await signIn(studentEmail);

    const res = await student.get(`/api/v1/items/${ids.quizItemId}/quiz`);
    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(2);
    expect(res.body.data.questions[0].options).toHaveLength(2);

    assertNoCorrectFlags(res.body, 'GET /items/:id/quiz');
  });

  it('does not send them in the course tree either', async () => {
    // The easiest place in the codebase to leak them: nothing about the call
    // site mentions quizzes.
    const student = await signIn(studentEmail);

    const res = await student.get(`/api/v1/courses/${ids.courseId}`);
    expect(res.status).toBe(200);
    assertNoCorrectFlags(res.body, 'GET /courses/:id');
  });

  it('refuses a quiz from a course the student was never assigned', async () => {
    // Publishing is about release *within* a course; it says nothing about
    // whether the caller was meant to see that course. Checking only
    // is_published on the item would let any student in the school open this
    // by id.
    const passwordHash = await hashPassword(PASSWORD);
    const outsider = await withTenant(ids.school, async (tx) => {
      const klass = await tx.class.create({
        data: { schoolId: ids.school, name: 'Y9', academicYear: '2026' },
      });
      const user = await tx.user.create({
        data: {
          schoolId: ids.school,
          email: `outsider@${SCHOOL.toLowerCase()}.test`,
          passwordHash,
          name: 'Outsider',
          role: 'STUDENT',
        },
      });
      await tx.enrollment.create({
        data: { schoolId: ids.school, classId: klass.id, studentId: user.id },
      });
      return user;
    });

    const agent = await signIn(`outsider@${SCHOOL.toLowerCase()}.test`);
    const res = await agent.get(`/api/v1/items/${ids.quizItemId}/quiz`);
    expect(res.status).toBe(404);

    const attempt = await agent.post(`/api/v1/items/${ids.quizItemId}/attempts`).send({});
    expect(attempt.status).toBe(404);

    void outsider;
  });

  it('does send them to staff, who need them to author', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher.get(`/api/v1/items/${ids.quizItemId}/quiz`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toMatch(/isCorrect/);
  });
});

describe('attempts', () => {
  it('records the start time server-side and derives the expiry', async () => {
    const teacher = await signIn(teacherEmail);
    await teacher.patch(`/api/v1/items/${ids.quizItemId}/quiz`).send({ timeLimitMinutes: 30 });

    const student = await signIn(studentEmail);
    const res = await student.post(`/api/v1/items/${ids.quizItemId}/attempts`).send({});

    expect(res.status).toBe(201);
    expect(res.body.data.startedAt).toBeTruthy();
    expect(res.body.data.expiresAt).toBeTruthy();

    const window = new Date(res.body.data.expiresAt).getTime() - new Date(res.body.data.startedAt).getTime();
    expect(window).toBe(30 * 60_000);
  });

  it('ignores any timestamp the client tries to supply', async () => {
    // The previous implementation read startedAt from the request body, so a
    // client sending the current time had no time limit at all. The schema is
    // strict, so the attempt is refused outright rather than quietly honoured.
    const student = await signIn(studentEmail);

    const attempt = await student.get(`/api/v1/items/${ids.quizItemId}/attempts`);
    const open = attempt.body.data.find((a: { status: string }) => a.status === 'IN_PROGRESS');
    expect(open).toBeTruthy();

    const res = await student
      .post(`/api/v1/attempts/${open.id}/submit`)
      .send({ answers: [], startedAt: new Date().toISOString() });

    expect(res.status).toBe(422);
  });

  it('resumes an open attempt rather than burning a second one', async () => {
    const student = await signIn(studentEmail);

    const first = await student.get(`/api/v1/items/${ids.quizItemId}/attempts`);
    const openId = first.body.data.find((a: { status: string }) => a.status === 'IN_PROGRESS').id;

    const again = await student.post(`/api/v1/items/${ids.quizItemId}/attempts`).send({});
    expect(again.body.data.id).toBe(openId);
  });

  it('grades server-side from the stored answers', async () => {
    const student = await signIn(studentEmail);

    const list = await student.get(`/api/v1/items/${ids.quizItemId}/attempts`);
    const attemptId = list.body.data.find((a: { status: string }) => a.status === 'IN_PROGRESS').id;

    // Answer the first correctly and the second wrongly, chosen by reading the
    // student-visible quiz — which does not say which is which, so the test
    // has to look them up the way the grader does.
    const quiz = await withTenant(ids.school, (tx) =>
      tx.quizQuestion.findMany({
        where: { quizId: ids.quizItemId },
        orderBy: { position: 'asc' },
        include: { options: true },
      })
    );

    const answers = [
      {
        questionId: quiz[0]!.id,
        selectedOptionId: quiz[0]!.options.find((o) => o.isCorrect)!.id,
      },
      {
        questionId: quiz[1]!.id,
        selectedOptionId: quiz[1]!.options.find((o) => !o.isCorrect)!.id,
      },
    ];

    const res = await student.post(`/api/v1/attempts/${attemptId}/submit`).send({
      answers,
      integrityFlags: { tabSwitches: 42 },
    });

    expect(res.status, res.text).toBe(200);
    expect(res.body.data.pointsEarned).toBe(1);
    expect(res.body.data.pointsPossible).toBe(2);
    expect(res.body.data.status).toBe('SUBMITTED');
    // 50% against a passing score of 50.
    expect(res.body.data.passed).toBe(true);
    // Advisory: recorded, never acted on. A flagged attempt still passed.
    expect(res.body.data.integrityFlags).toEqual({ tabSwitches: 42 });
  });

  it('refuses to submit the same attempt twice', async () => {
    const student = await signIn(studentEmail);
    const list = await student.get(`/api/v1/items/${ids.quizItemId}/attempts`);
    const submitted = list.body.data.find((a: { status: string }) => a.status === 'SUBMITTED');

    const res = await student.post(`/api/v1/attempts/${submitted.id}/submit`).send({ answers: [] });
    expect(res.status).toBe(409);
  });

  it('refuses an answer whose option belongs to a different question', async () => {
    const student = await signIn(studentEmail);
    const start = await student.post(`/api/v1/items/${ids.quizItemId}/attempts`).send({});
    expect(start.status).toBe(201);

    const questions = await withTenant(ids.school, (tx) =>
      tx.quizQuestion.findMany({
        where: { quizId: ids.quizItemId },
        orderBy: { position: 'asc' },
        include: { options: true },
      })
    );

    const res = await student.post(`/api/v1/attempts/${start.body.data.id}/submit`).send({
      answers: [
        {
          questionId: questions[0]!.id,
          selectedOptionId: questions[1]!.options[0]!.id, // belongs to question 2
        },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/outside its question/i);
  });

  it('enforces the attempt limit', async () => {
    const student = await signIn(studentEmail);

    // maxAttempts is 2 and both are now used.
    const res = await student.post(`/api/v1/items/${ids.quizItemId}/attempts`).send({});
    expect([409, 201]).toContain(res.status);

    if (res.status === 201) {
      // The second attempt was still open; submit it and try again.
      await student.post(`/api/v1/attempts/${res.body.data.id}/submit`).send({ answers: [] });
      const third = await student.post(`/api/v1/items/${ids.quizItemId}/attempts`).send({});
      expect(third.status).toBe(409);
    }
  });

  it('does not let one student read another’s attempt', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const other = await withTenant(ids.school, (tx) =>
      tx.user.create({
        data: {
          schoolId: ids.school,
          email: `other@${SCHOOL.toLowerCase()}.test`,
          passwordHash,
          name: 'Other',
          role: 'STUDENT',
        },
      })
    );
    await withTenant(ids.school, (tx) =>
      tx.enrollment.create({
        data: { schoolId: ids.school, classId: ids.klass, studentId: other.id },
      })
    );

    const student = await signIn(studentEmail);
    const list = await student.get(`/api/v1/items/${ids.quizItemId}/attempts`);
    const mine = list.body.data[0].id;

    // Same school, so RLS returns the row happily. Only the service-layer
    // owner check stands between classmates' grades — the recorded reason
    // per-student RLS is deferred (design §6.4).
    const classmate = await signIn(`other@${SCHOOL.toLowerCase()}.test`);
    const res = await classmate.get(`/api/v1/attempts/${mine}`);
    expect(res.status).toBe(404);

    // ...but staff may read it, which is what makes marking possible.
    const teacher = await signIn(teacherEmail);
    expect((await teacher.get(`/api/v1/attempts/${mine}`)).status).toBe(200);
  });
});

describe('the database backstop for grading integrity', () => {
  it('refuses a cross-question answer even written directly', async () => {
    // The service rejects this too, but the composite foreign key is what
    // makes it unrepresentable rather than merely unlikely.
    const questions = await withTenant(ids.school, (tx) =>
      tx.quizQuestion.findMany({
        where: { quizId: ids.quizItemId },
        orderBy: { position: 'asc' },
        include: { options: true },
      })
    );

    const attempt = await withTenant(ids.school, (tx) =>
      tx.quizAttempt.findFirst({ where: { quizId: ids.quizItemId } })
    );

    await expect(
      withTenant(ids.school, (tx) =>
        tx.quizAnswer.create({
          data: {
            schoolId: ids.school,
            attemptId: attempt!.id,
            questionId: questions[0]!.id,
            selectedOptionId: questions[1]!.options[0]!.id,
          },
        })
      )
    ).rejects.toThrow();
  });

  it('refuses a quizzes row on a non-quiz lesson item', async () => {
    const videoItem = await withTenant(ids.school, (tx) =>
      tx.lessonItem.create({
        data: {
          schoolId: ids.school,
          lessonId: ids.lessonId,
          kind: 'VIDEO',
          title: 'A video',
          video: { create: { schoolId: ids.school, provider: 'YOUTUBE' } },
        },
      })
    );

    await expect(
      withTenant(ids.school, (tx) =>
        tx.quiz.create({ data: { lessonItemId: videoItem.id, schoolId: ids.school } })
      )
    ).rejects.toThrow(/kind QUIZ/);
  });
});
