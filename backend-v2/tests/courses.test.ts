import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin, withTenant } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';

/**
 * Requirements §6 — course hierarchy, over HTTP.
 *
 * Two boundaries are under test and they are not the same thing:
 *
 *  - Between schools, enforced by RLS. Covered here at the API level and in
 *    rls.test.ts at the database level.
 *  - Inside a school, enforced by services/courseAccess.ts. RLS says nothing
 *    about it — every row involved already belongs to the caller's tenant —
 *    so these are the tests that stand between a student and another class's
 *    coursework.
 */

const PASSWORD = 'Passw0rd!x';
const OWNER_EMAIL = 'owner@courses.test';
const SCHOOL_A = 'CRS-A';
const SCHOOL_B = 'CRS-B';

const ids = {
  schoolA: '',
  schoolB: '',
  classA1: '',
  classA2: '',
  teacherA: '',
  courseA: '',
  lessonA: '',
};

const agent = () => request.agent(app);

const signIn = async (schoolCode: string, email: string) => {
  const a = agent();
  const res = await a.post('/api/v1/auth/login').send({ schoolCode, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${res.text}`).toBe(200);
  return a;
};

/** Seeds a school with a teacher, two classes and a student in each. */
const seedSchool = async (code: string, name: string) => {
  const passwordHash = await hashPassword(PASSWORD);

  const school = await asSuperAdmin((tx) =>
    tx.school.create({ data: { schoolCode: code, name, plan: 'STANDARD', studentCap: 2000 } })
  );

  return withTenant(school.id, async (tx) => {
    const teacher = await tx.user.create({
      data: {
        schoolId: school.id,
        email: `teacher@${code.toLowerCase()}.test`,
        passwordHash,
        name: 'Teacher',
        role: 'TEACHER',
      },
    });

    const admin = await tx.user.create({
      data: {
        schoolId: school.id,
        email: `admin@${code.toLowerCase()}.test`,
        passwordHash,
        name: 'Admin',
        role: 'SCHOOL_ADMIN',
      },
    });

    const classes = [];
    for (const suffix of ['1', '2']) {
      const klass = await tx.class.create({
        data: {
          schoolId: school.id,
          name: `Year ${suffix}`,
          academicYear: '2026',
          teacherId: teacher.id,
        },
      });

      const student = await tx.user.create({
        data: {
          schoolId: school.id,
          email: `student${suffix}@${code.toLowerCase()}.test`,
          passwordHash,
          name: `Student ${suffix}`,
          role: 'STUDENT',
        },
      });

      await tx.enrollment.create({
        data: { schoolId: school.id, classId: klass.id, studentId: student.id },
      });

      classes.push({ klass, student });
    }

    return { school, teacher, admin, classes };
  });
};

beforeAll(async () => {
  await asSuperAdmin((tx) =>
    tx.user.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: '',
        name: 'Owner',
        role: 'SUPER_ADMIN',
      },
    })
  );

  const a = await seedSchool(SCHOOL_A, 'Course Academy A');
  const b = await seedSchool(SCHOOL_B, 'Course Academy B');

  ids.schoolA = a.school.id;
  ids.schoolB = b.school.id;
  ids.classA1 = a.classes[0]!.klass.id;
  ids.classA2 = a.classes[1]!.klass.id;
  ids.teacherA = a.teacher.id;

  void b;
});

afterAll(async () => {
  await asSuperAdmin(async (tx) => {
    await tx.school.deleteMany({ where: { schoolCode: { in: [SCHOOL_A, SCHOOL_B] } } });
    await tx.user.deleteMany({ where: { email: OWNER_EMAIL } });
  });
  await prisma.$disconnect();
});

describe('course authoring', () => {
  it('creates a course with a usable default module and chapter', async () => {
    const teacher = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);

    const created = await teacher
      .post('/api/v1/courses')
      .send({ title: 'Algebra I', subject: 'Maths' });

    expect(created.status).toBe(201);
    expect(created.body.data.slug).toBe('algebra-i');
    expect(created.body.data.status).toBe('DRAFT');
    ids.courseA = created.body.data.id;

    // §4.3: the four mandated levels must not cost four calls before a
    // teacher can add content.
    const tree = await teacher.get(`/api/v1/courses/${ids.courseA}`);
    expect(tree.status).toBe(200);
    expect(tree.body.data.modules).toHaveLength(1);
    expect(tree.body.data.modules[0].chapters).toHaveLength(1);

    const chapterId = tree.body.data.modules[0].chapters[0].id;
    const lesson = await teacher
      .post(`/api/v1/chapters/${chapterId}/lessons`)
      .send({ title: 'Linear equations' });
    expect(lesson.status).toBe(201);
    ids.lessonA = lesson.body.data.id;
  });

  it('de-duplicates slugs within a school but allows reuse across schools', async () => {
    const teacherA = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);
    const teacherB = await signIn(SCHOOL_B, `teacher@${SCHOOL_B.toLowerCase()}.test`);

    const dupe = await teacherA.post('/api/v1/courses').send({ title: 'Algebra I' });
    expect(dupe.status).toBe(201);
    expect(dupe.body.data.slug).toBe('algebra-i-2');

    // A different tenant is free to use the original slug: uniqueness is
    // (school_id, slug), not global.
    const other = await teacherB.post('/api/v1/courses').send({ title: 'Algebra I' });
    expect(other.status).toBe(201);
    expect(other.body.data.slug).toBe('algebra-i');
  });

  it('rejects an unknown item kind', async () => {
    const teacher = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);

    const res = await teacher
      .post(`/api/v1/lessons/${ids.lessonA}/items`)
      .send({ kind: 'PODCAST', title: 'Nope' });

    // All three §6 kinds are implemented now — VIDEO here, QUIZ in
    // tests/quizzes.test.ts, ASSIGNMENT in tests/assignments.test.ts — so the
    // only thing left to refuse is a kind that does not exist.
    expect(res.status).toBe(422);
  });

  it('creates video items and orders them by position', async () => {
    const teacher = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);

    for (const title of ['Intro', 'Worked example', 'Recap']) {
      const res = await teacher.post(`/api/v1/lessons/${ids.lessonA}/items`).send({
        kind: 'VIDEO',
        title,
        provider: 'YOUTUBE',
        externalUrl: 'https://example.com/v',
        isPublished: true,
      });
      expect(res.status, res.text).toBe(201);
      expect(res.body.data.video).toBeTruthy();
    }

    const tree = await teacher.get(`/api/v1/courses/${ids.courseA}`);
    const items = tree.body.data.modules[0].chapters[0].lessons[0].items;
    expect(items.map((i: { title: string }) => i.title)).toEqual([
      'Intro',
      'Worked example',
      'Recap',
    ]);
  });

  it('reorders items atomically and rejects an incomplete list', async () => {
    const teacher = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);

    const before = await teacher.get(`/api/v1/courses/${ids.courseA}`);
    const items = before.body.data.modules[0].chapters[0].lessons[0].items;
    const reversed = [...items].reverse().map((i: { id: string }) => i.id);

    const partial = await teacher
      .post(`/api/v1/lessons/${ids.lessonA}/items/reorder`)
      .send({ itemIds: reversed.slice(0, 2) });
    // A partial reorder has to interleave with positions it was not told
    // about, so it is refused rather than half-applied.
    expect(partial.status).toBe(400);

    const ok = await teacher
      .post(`/api/v1/lessons/${ids.lessonA}/items/reorder`)
      .send({ itemIds: reversed });
    expect(ok.status).toBe(200);
    expect(ok.body.data.map((i: { title: string }) => i.title)).toEqual([
      'Recap',
      'Worked example',
      'Intro',
    ]);
  });
});

describe('student visibility — the part RLS does not enforce', () => {
  beforeAll(async () => {
    const teacher = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);
    await teacher.patch(`/api/v1/courses/${ids.courseA}`).send({ status: 'PUBLISHED' });
    await teacher.post(`/api/v1/courses/${ids.courseA}/classes`).send({ classId: ids.classA1 });
  });

  it('shows a published, assigned course to a student in that class', async () => {
    const student = await signIn(SCHOOL_A, `student1@${SCHOOL_A.toLowerCase()}.test`);

    const list = await student.get('/api/v1/courses');
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(ids.courseA);
  });

  it('hides it from a student in another class of the same school', async () => {
    // Same tenant, so RLS returns the row happily. Only the service-layer
    // filter stands between year 2 and year 1's coursework.
    const student = await signIn(SCHOOL_A, `student2@${SCHOOL_A.toLowerCase()}.test`);

    const list = await student.get('/api/v1/courses');
    expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(ids.courseA);

    const direct = await student.get(`/api/v1/courses/${ids.courseA}`);
    // 404 rather than 403: guessing an id must not confirm the course exists.
    expect(direct.status).toBe(404);
  });

  it('hides unpublished items from students but shows them to staff', async () => {
    const teacher = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);
    const tree = await teacher.get(`/api/v1/courses/${ids.courseA}`);
    const items = tree.body.data.modules[0].chapters[0].lessons[0].items;

    const hidden = await teacher
      .patch(`/api/v1/items/${items[0].id}`)
      .send({ isPublished: false });
    expect(hidden.status).toBe(200);

    const student = await signIn(SCHOOL_A, `student1@${SCHOOL_A.toLowerCase()}.test`);
    const studentTree = await student.get(`/api/v1/courses/${ids.courseA}`);
    const studentItems = studentTree.body.data.modules[0].chapters[0].lessons[0].items;

    expect(studentItems.map((i: { id: string }) => i.id)).not.toContain(items[0].id);
    expect(studentItems).toHaveLength(items.length - 1);

    const staffTree = await teacher.get(`/api/v1/courses/${ids.courseA}`);
    expect(staffTree.body.data.modules[0].chapters[0].lessons[0].items).toHaveLength(items.length);
  });

  it('does not let a student author anything', async () => {
    const student = await signIn(SCHOOL_A, `student1@${SCHOOL_A.toLowerCase()}.test`);

    const res = await student.post('/api/v1/courses').send({ title: 'Not allowed' });
    expect(res.status).toBe(403);
  });
});

describe('tenant isolation across schools', () => {
  it('does not return school A courses to school B', async () => {
    const teacherB = await signIn(SCHOOL_B, `teacher@${SCHOOL_B.toLowerCase()}.test`);

    const list = await teacherB.get('/api/v1/courses');
    expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(ids.courseA);
  });

  it('refuses a direct read of another school course by id', async () => {
    const teacherB = await signIn(SCHOOL_B, `teacher@${SCHOOL_B.toLowerCase()}.test`);

    const res = await teacherB.get(`/api/v1/courses/${ids.courseA}`);
    expect(res.status).toBe(404);
  });

  it('refuses a direct update of another school course by id', async () => {
    const teacherB = await signIn(SCHOOL_B, `teacher@${SCHOOL_B.toLowerCase()}.test`);

    const res = await teacherB
      .patch(`/api/v1/courses/${ids.courseA}`)
      .send({ title: 'Hijacked' });
    expect(res.status).toBe(404);

    // And the row is untouched.
    const teacherA = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);
    const check = await teacherA.get(`/api/v1/courses/${ids.courseA}`);
    expect(check.body.data.title).toBe('Algebra I');
  });

  it('refuses to attach another school class to a course', async () => {
    const teacherA = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);

    const foreignClass = await withTenant(ids.schoolB, (tx) =>
      tx.class.findFirst({ select: { id: true } })
    );

    const res = await teacherA
      .post(`/api/v1/courses/${ids.courseA}/classes`)
      .send({ classId: foreignClass!.id });

    // The class is invisible under RLS, so it never reaches the parity
    // trigger — but the trigger is the backstop if this check were removed.
    expect(res.status).toBe(404);
  });
});

/**
 * Requirements §2 — classes and enrolment.
 *
 * These exist because a class is how a course reaches a student: until this
 * API existed the whole hierarchy could be built and never handed to anyone,
 * and the e2e script had to seed a class directly to work around it.
 */
describe('classes', () => {
  it('lets a school admin create a class and enrol a student', async () => {
    const admin = await signIn(SCHOOL_A, `admin@${SCHOOL_A.toLowerCase()}.test`);

    const created = await admin
      .post('/api/v1/classes')
      .send({ name: 'Year 7', academicYear: '2027' });
    expect(created.status, created.text).toBe(201);

    const student = await withTenant(ids.schoolA, (tx) =>
      tx.user.findFirst({ where: { role: 'STUDENT' }, select: { id: true } })
    );

    const enrolled = await admin
      .post(`/api/v1/classes/${created.body.data.id}/enrollments`)
      .send({ studentId: student!.id });
    expect(enrolled.status).toBe(201);

    // Idempotent: the caller's intent is satisfied either way.
    const again = await admin
      .post(`/api/v1/classes/${created.body.data.id}/enrollments`)
      .send({ studentId: student!.id });
    expect(again.status).toBe(201);

    const roll = await admin.get(`/api/v1/classes/${created.body.data.id}/enrollments`);
    expect(roll.body.data).toHaveLength(1);
  });

  it('lets a teacher read classes but not create them', async () => {
    const teacher = await signIn(SCHOOL_A, `teacher@${SCHOOL_A.toLowerCase()}.test`);

    // A teacher needs the list to attach a course to a class; deciding who is
    // in which class is an administrative act.
    expect((await teacher.get('/api/v1/classes')).status).toBe(200);

    const created = await teacher
      .post('/api/v1/classes')
      .send({ name: 'Teacher made', academicYear: '2027' });
    expect(created.status).toBe(403);
  });

  it('does not show another school its neighbour’s classes', async () => {
    const adminB = await signIn(SCHOOL_B, `admin@${SCHOOL_B.toLowerCase()}.test`);

    const list = await adminB.get('/api/v1/classes');
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(ids.classA1);
  });

  it('refuses to enrol a student from another school', async () => {
    const adminA = await signIn(SCHOOL_A, `admin@${SCHOOL_A.toLowerCase()}.test`);

    const foreignStudent = await withTenant(ids.schoolB, (tx) =>
      tx.user.findFirst({ where: { role: 'STUDENT' }, select: { id: true } })
    );

    // RLS makes them invisible, so this surfaces as "no such student" rather
    // than a foreign-key error.
    const res = await adminA
      .post(`/api/v1/classes/${ids.classA1}/enrollments`)
      .send({ studentId: foreignStudent!.id });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate class name in the same academic year', async () => {
    const admin = await signIn(SCHOOL_A, `admin@${SCHOOL_A.toLowerCase()}.test`);

    const res = await admin.post('/api/v1/classes').send({ name: 'Year 7', academicYear: '2027' });
    expect(res.status).toBe(409);
  });
});
