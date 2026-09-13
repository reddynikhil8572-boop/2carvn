import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin, withTenant } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';

/**
 * Requirements §10 — certificates.
 *
 * The tests that carry this increment are about a credential's job: it has to
 * outlive the course it came from, it has to be checkable by a stranger, and
 * it has to stop being checkable the moment it is revoked — without leaking
 * anything else about the school on the way.
 */

const PASSWORD = 'Passw0rd!x';
const SCHOOL = 'CT-A';

const ids = { school: '', klass: '', courseId: '', studentId: '', outsiderId: '', serial: '' };

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
      data: { schoolCode: SCHOOL, name: 'Certificate College', plan: 'STANDARD', studentCap: 2000 },
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
    const student = await tx.user.create({
      data: {
        schoolId: school.id,
        email: studentEmail,
        passwordHash,
        name: 'Priya Raman',
        role: 'STUDENT',
      },
    });
    await tx.enrollment.create({
      data: { schoolId: school.id, classId: klass.id, studentId: student.id },
    });

    // Enrolled in the school but not in any class taking the course.
    const outsider = await tx.user.create({
      data: {
        schoolId: school.id,
        email: `outsider@${SCHOOL.toLowerCase()}.test`,
        passwordHash,
        name: 'Outsider',
        role: 'STUDENT',
      },
    });

    ids.klass = klass.id;
    ids.studentId = student.id;
    ids.outsiderId = outsider.id;
  });

  const teacher = await signIn(teacherEmail);
  const course = await teacher.post('/api/v1/courses').send({ title: 'Astronomy' });
  ids.courseId = course.body.data.id;
  await teacher.patch(`/api/v1/courses/${ids.courseId}`).send({ status: 'PUBLISHED' });
  await teacher.post(`/api/v1/courses/${ids.courseId}/classes`).send({ classId: ids.klass });
});

afterAll(async () => {
  await asSuperAdmin(async (tx) => {
    await tx.certificate.deleteMany({ where: { schoolId: ids.school } });
    await tx.school.deleteMany({ where: { schoolCode: SCHOOL } });
  });
  await prisma.$disconnect();
});

describe('issuing', () => {
  it('issues to a student actually taking the course', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher
      .post(`/api/v1/courses/${ids.courseId}/certificates`)
      .send({ studentId: ids.studentId });

    expect(res.status, res.text).toBe(201);
    expect(res.body.data.serial).toMatch(/^EDU-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // Denormalised at issue time — the credential records what was true then.
    expect(res.body.data.studentName).toBe('Priya Raman');
    expect(res.body.data.courseTitle).toBe('Astronomy');

    ids.serial = res.body.data.serial;
  });

  it('refuses a student who is not taking the course', async () => {
    // Without this check, "issue a certificate for this course" would accept
    // any user id in the school.
    const teacher = await signIn(teacherEmail);

    const res = await teacher
      .post(`/api/v1/courses/${ids.courseId}/certificates`)
      .send({ studentId: ids.outsiderId });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not taking this course/i);
  });

  it('refuses a second live certificate for the same student and course', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher
      .post(`/api/v1/courses/${ids.courseId}/certificates`)
      .send({ studentId: ids.studentId });

    expect(res.status).toBe(409);
  });

  it('does not let a student issue their own', async () => {
    const student = await signIn(studentEmail);

    const res = await student
      .post(`/api/v1/courses/${ids.courseId}/certificates`)
      .send({ studentId: ids.studentId });

    expect(res.status).toBe(403);
  });
});

describe('public verification', () => {
  it('resolves for a stranger with no session at all', async () => {
    // No agent, no cookies — this is the one route in the system that reads
    // tenant data unauthenticated.
    const res = await request(app).get(`/api/v1/certificates/${ids.serial}`);

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.studentName).toBe('Priya Raman');
    expect(res.body.data.courseTitle).toBe('Astronomy');
    expect(res.body.data.schoolName).toBe('Certificate College');
  });

  it('exposes nothing else about the school', async () => {
    const res = await request(app).get(`/api/v1/certificates/${ids.serial}`);

    // A verifier is answering "is this credential real", not browsing a
    // school. No ids, no email, no class, no roster.
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(ids.studentId);
    expect(serialised).not.toContain(ids.courseId);
    expect(serialised).not.toContain(ids.school);
    expect(serialised).not.toContain('@');
    expect(Object.keys(res.body.data).sort()).toEqual([
      'courseTitle',
      'issuedAt',
      'revokeReason',
      'revokedAt',
      'schoolName',
      'serial',
      'studentName',
      'valid',
    ]);
  });

  it('404s an unknown serial without saying anything else', async () => {
    const res = await request(app).get('/api/v1/certificates/EDU-ZZZZ-ZZZZ-ZZZZ');
    expect(res.status).toBe(404);
  });

  it('rejects a malformed serial before it reaches the handler', async () => {
    const res = await request(app).get("/api/v1/certificates/' OR 1=1--");
    expect(res.status).toBe(422);
  });

  it('renders a PDF on demand', async () => {
    const res = await request(app).get(`/api/v1/certificates/${ids.serial}/download`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    // %PDF- magic: proves a document came back, not an error page.
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('a credential outlives its course', () => {
  it('survives the course being archived', async () => {
    const teacher = await signIn(teacherEmail);
    const archived = await teacher
      .patch(`/api/v1/courses/${ids.courseId}`)
      .send({ status: 'ARCHIVED' });
    expect(archived.status).toBe(200);

    // A certificate that stops verifying because a teacher tidied up an old
    // course is a credential the holder can no longer prove.
    const res = await request(app).get(`/api/v1/certificates/${ids.serial}`);
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);

    await teacher.patch(`/api/v1/courses/${ids.courseId}`).send({ status: 'PUBLISHED' });
  });

  it('keeps the title it was issued with when the course is renamed', async () => {
    const teacher = await signIn(teacherEmail);
    await teacher.patch(`/api/v1/courses/${ids.courseId}`).send({ title: 'Astrophysics' });

    const res = await request(app).get(`/api/v1/certificates/${ids.serial}`);
    expect(res.body.data.courseTitle).toBe('Astronomy');
  });

  it('refuses to delete a course that has certificates', async () => {
    // onDelete: Restrict. Nothing in the API deletes courses, but the database
    // is the thing that has to hold if something ever tries.
    await expect(
      withTenant(ids.school, (tx) => tx.course.delete({ where: { id: ids.courseId } }))
    ).rejects.toThrow();
  });
});

describe('revocation', () => {
  it('stops verification passing and stops the PDF rendering', async () => {
    const teacher = await signIn(teacherEmail);

    const revoked = await teacher
      .post(`/api/v1/certificates/${ids.serial}/revoke`)
      .send({ reason: 'Issued in error' });
    expect(revoked.status).toBe(200);

    const check = await request(app).get(`/api/v1/certificates/${ids.serial}`);
    // Still resolves, and says it was revoked. Answering "no such certificate"
    // would be a lie that works in the holder's favour.
    expect(check.status).toBe(200);
    expect(check.body.data.valid).toBe(false);
    expect(check.body.data.revokeReason).toBe('Issued in error');

    // Nothing was ever written to storage, so revocation takes effect on the
    // next request rather than needing a file chased down in a bucket.
    const pdf = await request(app).get(`/api/v1/certificates/${ids.serial}/download`);
    expect(pdf.status).toBe(410);
  });

  it('allows reissue once revoked, because the unique index is partial', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher
      .post(`/api/v1/courses/${ids.courseId}/certificates`)
      .send({ studentId: ids.studentId });

    expect(res.status, res.text).toBe(201);
    expect(res.body.data.serial).not.toBe(ids.serial);
  });

  it('refuses to revoke twice', async () => {
    const teacher = await signIn(teacherEmail);
    const res = await teacher.post(`/api/v1/certificates/${ids.serial}/revoke`).send({});
    expect(res.status).toBe(409);
  });
});

describe('tenant isolation', () => {
  it('does not let another school revoke a certificate', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const other = await asSuperAdmin((tx) =>
      tx.school.create({ data: { schoolCode: 'CT-B', name: 'Other College' } })
    );
    await withTenant(other.id, (tx) =>
      tx.user.create({
        data: {
          schoolId: other.id,
          email: 'teacher@ct-b.test',
          passwordHash,
          name: 'Other T',
          role: 'TEACHER',
        },
      })
    );

    const a = request.agent(app);
    const login = await a
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'CT-B', email: 'teacher@ct-b.test', password: PASSWORD });
    expect(login.status).toBe(200);

    const live = await withTenant(ids.school, (tx) =>
      tx.certificate.findFirst({ where: { revokedAt: null } })
    );

    const res = await a.post(`/api/v1/certificates/${live!.serial}/revoke`).send({});
    expect(res.status).toBe(404);

    await asSuperAdmin((tx) => tx.school.deleteMany({ where: { schoolCode: 'CT-B' } }));
  });
});
