import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin, withTenant } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';

/**
 * Requirements §12 — assignments: submission and manual grading.
 *
 * The tests that carry this increment are the ones about *who decides what*:
 * the server decides lateness, the server bounds the mark, and a classmate
 * decides nothing at all about someone else's work.
 */

const PASSWORD = 'Passw0rd!x';
const SCHOOL = 'AS-A';

const ids = {
  school: '',
  klass: '',
  courseId: '',
  lessonId: '',
  openItem: '',
  closedItem: '',
};

const teacherEmail = `teacher@${SCHOOL.toLowerCase()}.test`;
const studentEmail = `student@${SCHOOL.toLowerCase()}.test`;
const peerEmail = `peer@${SCHOOL.toLowerCase()}.test`;

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
      data: { schoolCode: SCHOOL, name: 'Assignment Academy', plan: 'STANDARD', studentCap: 2000 },
    })
  );
  ids.school = school.id;

  await withTenant(school.id, async (tx) => {
    const teacher = await tx.user.create({
      data: { schoolId: school.id, email: teacherEmail, passwordHash, name: 'T', role: 'TEACHER' },
    });
    const klass = await tx.class.create({
      data: { schoolId: school.id, name: 'Y1', academicYear: '2026', teacherId: teacher.id },
    });

    for (const email of [studentEmail, peerEmail]) {
      const student = await tx.user.create({
        data: { schoolId: school.id, email, passwordHash, name: email, role: 'STUDENT' },
      });
      await tx.enrollment.create({
        data: { schoolId: school.id, classId: klass.id, studentId: student.id },
      });
    }

    ids.klass = klass.id;
  });

  const teacher = await signIn(teacherEmail);

  const course = await teacher.post('/api/v1/courses').send({ title: 'History' });
  ids.courseId = course.body.data.id;

  const tree = await teacher.get(`/api/v1/courses/${ids.courseId}`);
  const chapterId = tree.body.data.modules[0].chapters[0].id;

  const lesson = await teacher
    .post(`/api/v1/chapters/${chapterId}/lessons`)
    .send({ title: 'Sources' });
  ids.lessonId = lesson.body.data.id;

  // One assignment still open, one whose deadline has passed and which refuses
  // late work.
  const open = await teacher.post(`/api/v1/lessons/${ids.lessonId}/items`).send({
    kind: 'ASSIGNMENT',
    title: 'Essay',
    isPublished: true,
    maxPoints: 20,
  });
  expect(open.status, open.text).toBe(201);
  ids.openItem = open.body.data.id;

  const closed = await teacher.post(`/api/v1/lessons/${ids.lessonId}/items`).send({
    kind: 'ASSIGNMENT',
    title: 'Past deadline',
    isPublished: true,
    dueAt: new Date(Date.now() - 60_000).toISOString(),
    allowsLate: false,
  });
  expect(closed.status, closed.text).toBe(201);
  ids.closedItem = closed.body.data.id;

  await teacher.patch(`/api/v1/courses/${ids.courseId}`).send({ status: 'PUBLISHED' });
  await teacher.post(`/api/v1/courses/${ids.courseId}/classes`).send({ classId: ids.klass });
});

afterAll(async () => {
  await asSuperAdmin((tx) => tx.school.deleteMany({ where: { schoolCode: SCHOOL } }));
  await prisma.$disconnect();
});

describe('submission', () => {
  it('accepts text work and records it as on time', async () => {
    const student = await signIn(studentEmail);

    const res = await student
      .post(`/api/v1/items/${ids.openItem}/submissions`)
      .send({ bodyText: 'My essay.' });

    expect(res.status, res.text).toBe(201);
    expect(res.body.data.isLate).toBe(false);
    expect(res.body.data.status).toBe('SUBMITTED');
  });

  it('decides lateness itself rather than taking the client’s word', async () => {
    const teacher = await signIn(teacherEmail);
    // Move the deadline into the past on the open assignment, but keep late
    // work allowed.
    await teacher
      .patch(`/api/v1/items/${ids.openItem}/assignment`)
      .send({ dueAt: new Date(Date.now() - 60_000).toISOString() });

    const student = await signIn(peerEmail);
    const res = await student
      .post(`/api/v1/items/${ids.openItem}/submissions`)
      .send({ bodyText: 'Late but accepted.' });

    expect(res.status).toBe(201);
    expect(res.body.data.isLate).toBe(true);

    // Restore for the remaining tests.
    await teacher.patch(`/api/v1/items/${ids.openItem}/assignment`).send({ dueAt: null });
  });

  it('does not let the client claim a submission time', async () => {
    const student = await signIn(studentEmail);

    const res = await student
      .post(`/api/v1/items/${ids.openItem}/submissions`)
      .send({ bodyText: 'x', submittedAt: new Date(0).toISOString() });

    // The schema is strict, so an attempt to state the time is refused rather
    // than quietly ignored.
    expect(res.status).toBe(422);
  });

  it('refuses late work when the assignment does not allow it', async () => {
    const student = await signIn(studentEmail);

    const res = await student
      .post(`/api/v1/items/${ids.closedItem}/submissions`)
      .send({ bodyText: 'Too late.' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/deadline/i);
  });

  it('refuses a file attachment on an assignment that does not accept one', async () => {
    const student = await signIn(studentEmail);

    const res = await student
      .post(`/api/v1/items/${ids.openItem}/submissions`)
      .send({ bodyText: 'With a file', fileKey: 'uploads/essay.pdf' });

    // This was a 501 until object storage landed. Now storage exists, so the
    // refusal is about `allowsFile` (false on this assignment) rather than
    // about the capability being absent. The upload path itself is covered in
    // tests/storage.test.ts.
    expect(res.status).toBe(400);
  });

  it('replaces an ungraded submission rather than creating a second', async () => {
    const student = await signIn(studentEmail);

    const again = await student
      .post(`/api/v1/items/${ids.openItem}/submissions`)
      .send({ bodyText: 'Second draft.' });
    expect(again.status).toBe(201);

    const count = await withTenant(ids.school, (tx) =>
      tx.assignmentSubmission.count({ where: { assignmentId: ids.openItem } })
    );
    expect(count).toBe(2); // one per student, not one per attempt
    expect(again.body.data.bodyText).toBe('Second draft.');
  });

  it('does not let staff submit', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher
      .post(`/api/v1/items/${ids.openItem}/submissions`)
      .send({ bodyText: 'Not my job.' });

    expect(res.status).toBe(403);
  });
});

describe('grading', () => {
  it('marks work and bounds the mark by max_points', async () => {
    const teacher = await signIn(teacherEmail);

    const view = await teacher.get(`/api/v1/items/${ids.openItem}/assignment`);
    const mine = view.body.data.submissions.find(
      (s: { student: { name: string } }) => s.student.name === studentEmail
    );

    // maxPoints is 20. A mark above it silently breaks every average computed
    // from it later.
    const tooHigh = await teacher
      .post(`/api/v1/submissions/${mine.id}/grade`)
      .send({ points: 40, feedback: 'Impossible' });
    expect(tooHigh.status).toBe(400);

    const ok = await teacher
      .post(`/api/v1/submissions/${mine.id}/grade`)
      .send({ points: 17, feedback: 'Solid argument.' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.points).toBe(17);
    expect(ok.body.data.status).toBe('GRADED');
    expect(ok.body.data.gradedAt).toBeTruthy();
  });

  it('refuses a rewrite once the work has been graded', async () => {
    const student = await signIn(studentEmail);

    const res = await student
      .post(`/api/v1/items/${ids.openItem}/submissions`)
      .send({ bodyText: 'Sneaky rewrite.' });

    // Otherwise a student could replace the very work the mark refers to.
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already been graded/i);
  });

  it('clears the mark when work is returned for revision', async () => {
    const teacher = await signIn(teacherEmail);
    const view = await teacher.get(`/api/v1/items/${ids.openItem}/assignment`);
    const peer = view.body.data.submissions.find(
      (s: { student: { name: string } }) => s.student.name === peerEmail
    );

    await teacher.post(`/api/v1/submissions/${peer.id}/grade`).send({ points: 10 });

    const returned = await teacher
      .post(`/api/v1/submissions/${peer.id}/grade`)
      .send({ status: 'RETURNED', feedback: 'Please expand section 2.' });

    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe('RETURNED');
    // A resubmission must not silently carry the old score.
    expect(returned.body.data.points).toBeNull();
    expect(returned.body.data.gradedAt).toBeNull();

    // ...and the student may now submit again.
    const student = await signIn(peerEmail);
    const again = await student
      .post(`/api/v1/items/${ids.openItem}/submissions`)
      .send({ bodyText: 'Expanded section 2.' });
    expect(again.status).toBe(201);
  });

  it('does not let a student grade their own work', async () => {
    const student = await signIn(studentEmail);
    const own = await withTenant(ids.school, (tx) =>
      tx.assignmentSubmission.findFirst({ where: { assignmentId: ids.openItem } })
    );

    const res = await student.post(`/api/v1/submissions/${own!.id}/grade`).send({ points: 20 });
    expect(res.status).toBe(403);
  });
});

describe('one student’s work is not another’s business', () => {
  it('hides a classmate’s submission, mark and feedback', async () => {
    const teacher = await signIn(teacherEmail);
    const view = await teacher.get(`/api/v1/items/${ids.openItem}/assignment`);
    const someone = view.body.data.submissions.find(
      (s: { student: { name: string } }) => s.student.name === studentEmail
    );

    // Same school, so RLS returns the row. Only the service-layer owner check
    // stands between classmates' marks — the recorded reason per-student RLS
    // is deferred (design §6.4).
    const peer = await signIn(peerEmail);
    const direct = await peer.get(`/api/v1/submissions/${someone.id}`);
    expect(direct.status).toBe(404);

    // And the assignment view returns only their own.
    const list = await peer.get(`/api/v1/items/${ids.openItem}/assignment`);
    expect(list.status).toBe(200);
    expect(list.body.data.submissions).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('Solid argument.');
  });

  it('keeps marks out of the course tree entirely', async () => {
    const peer = await signIn(peerEmail);

    const tree = await peer.get(`/api/v1/courses/${ids.courseId}`);
    expect(tree.status).toBe(200);

    // The tree carries assignment metadata, never submissions — a bare
    // `assignment: true` with its relations would hand every student the whole
    // class's marks.
    const serialised = JSON.stringify(tree.body);
    expect(serialised).not.toContain('Solid argument.');
    expect(serialised).not.toMatch(/submissions/i);
  });
});

describe('the database backstop', () => {
  it('refuses an assignments row on a non-assignment lesson item', async () => {
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
        tx.assignment.create({ data: { lessonItemId: videoItem.id, schoolId: ids.school } })
      )
    ).rejects.toThrow(/kind ASSIGNMENT/);
  });
});
