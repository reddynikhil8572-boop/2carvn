import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin, withTenant } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';

/**
 * Subject access export and erasure.
 *
 * Two properties decide whether this feature is real, and both are easy to
 * write a green test around without actually holding:
 *
 *  1. **The export is complete.** One that silently omits a table is worse than
 *     none, because it will be relied on to answer a legal request.
 *  2. **Erasure actually erases, and does not take the school's records with
 *     it.** "Returns 200" proves neither half.
 *
 * So the assertions here are: the name appears *nowhere* afterwards, the person
 * cannot log in, and the academic records still exist — checked by counting
 * rows, not by trusting the report the endpoint returned about itself.
 */

const OWNER = 'owner@privacy.test';
const ADMIN = 'admin@privacy.test';
const ADMIN2 = 'admin2@privacy.test';
const TEACHER = 'teacher@privacy.test';
const STUDENT = 'pupil@privacy.test';
const OTHER_ADMIN = 'admin@privacy-b.test';
const OTHER_STUDENT = 'pupil@privacy-b.test';

const PASSWORD = 'Passw0rd!x';
const SCHOOL = 'PRIV-A';
const SCHOOL_B = 'PRIV-B';

/** Distinctive enough that finding it anywhere afterwards is unambiguous. */
const STUDENT_NAME = 'Wilhelmina Quixotebury';

/**
 * Two keys, to cover both branches of the storage deletion.
 *
 * `FILE_KEY_OK` need not exist: S3 DeleteObject is idempotent and succeeds for
 * a key that was never there, which is the right semantics here — the question
 * erasure has to answer is "does an object with this key remain?", and after a
 * successful delete the answer is no either way.
 *
 * `FILE_KEY_BAD` exceeds S3's 1024-byte key limit, so the delete genuinely
 * fails. That branch is the one that matters: it is what proves the report
 * says "failed" instead of quietly claiming success.
 */
const FILE_KEY_OK = 'schools/fictional/submissions/essay.pdf';
const FILE_KEY_BAD = `schools/fictional/submissions/${'x'.repeat(1200)}.pdf`;

let admin: ReturnType<typeof request.agent>;
let otherAdmin: ReturnType<typeof request.agent>;
let schoolId: string;
let studentId: string;
let teacherId: string;
let adminId: string;
let otherStudentId: string;
let courseId: string;

const login = async (agent: ReturnType<typeof request.agent>, body: object) => {
  const res = await agent.post('/api/v1/auth/login').send(body);
  expect(res.status, res.text).toBe(200);
  return agent;
};

beforeAll(async () => {
  const owner = request.agent(app);

  await asSuperAdmin(async (tx) => {
    await tx.user.create({
      data: {
        email: OWNER,
        passwordHash: await hashPassword(PASSWORD),
        name: 'Owner',
        role: 'SUPER_ADMIN',
      },
    });
  });
  await login(owner, { email: OWNER, password: PASSWORD });

  for (const [code, name, email] of [
    [SCHOOL, 'Privacy School', ADMIN],
    [SCHOOL_B, 'Other School', OTHER_ADMIN],
  ] as const) {
    await owner
      .post('/api/v1/super-admin/schools')
      .send({ schoolCode: code, name, admin: { email, name: 'Admin', password: PASSWORD } })
      .expect(201);
  }

  admin = await login(request.agent(app), {
    schoolCode: SCHOOL,
    email: ADMIN,
    password: PASSWORD,
  });
  otherAdmin = await login(request.agent(app), {
    schoolCode: SCHOOL_B,
    email: OTHER_ADMIN,
    password: PASSWORD,
  });

  for (const [email, name, role] of [
    [ADMIN2, 'Second Admin', 'SCHOOL_ADMIN'],
    [TEACHER, 'A Teacher', 'TEACHER'],
    [STUDENT, STUDENT_NAME, 'STUDENT'],
  ] as const) {
    await admin
      .post('/api/v1/school-admin/users')
      .send({ email, name, role, password: PASSWORD })
      .expect(201);
  }
  await otherAdmin
    .post('/api/v1/school-admin/users')
    .send({ email: OTHER_STUDENT, name: 'Other Pupil', role: 'STUDENT', password: PASSWORD })
    .expect(201);

  const school = await asSuperAdmin((tx) =>
    tx.school.findUniqueOrThrow({ where: { schoolCode: SCHOOL } })
  );
  schoolId = school.id;

  await withTenant(schoolId, async (tx) => {
    studentId = (await tx.user.findFirstOrThrow({ where: { email: STUDENT } })).id;
    teacherId = (await tx.user.findFirstOrThrow({ where: { email: TEACHER } })).id;
    adminId = (await tx.user.findFirstOrThrow({ where: { email: ADMIN } })).id;

    // A class with the pupil on its roster, so erasure has something whose
    // survival can be checked.
    const klass = await tx.class.create({
      data: { schoolId, name: 'Form 3B', academicYear: '2026', teacherId },
    });
    await tx.enrollment.create({ data: { schoolId, classId: klass.id, studentId } });

    const course = await tx.course.create({
      data: { schoolId, title: 'Latin', slug: 'latin', createdBy: teacherId },
    });
    courseId = course.id;

    /*
     * A submission carrying a file key, so erasure has an object to deal with.
     *
     * The key is fictional and no object exists behind it — that is the point.
     * With no storage configured under NODE_ENV=test, the deletion must be
     * reported as FAILED rather than quietly succeeding; a helper that said
     * "deleted" about a bucket it never contacted would make the report a lie
     * in precisely the situation someone relies on it.
     */
    const mod = await tx.module.create({
      data: { schoolId, courseId, title: 'M1', position: 1 },
    });
    const chapter = await tx.chapter.create({
      data: { schoolId, moduleId: mod.id, title: 'C1', position: 1 },
    });
    const lesson = await tx.lesson.create({
      data: { schoolId, chapterId: chapter.id, title: 'L1', position: 1 },
    });
    // Two assignments, because a student may hold only one submission per
    // assignment (@@unique([assignmentId, studentId])).
    for (const [n, key] of [
      [1, FILE_KEY_OK],
      [2, FILE_KEY_BAD],
    ] as const) {
      const item = await tx.lessonItem.create({
        data: {
          schoolId,
          lessonId: lesson.id,
          kind: 'ASSIGNMENT',
          title: `Essay ${n}`,
          position: n,
        },
      });
      // Assignment's primary key IS lessonItemId — it has no separate id.
      const assignment = await tx.assignment.create({
        data: { schoolId, lessonItemId: item.id, maxPoints: 10, allowsFile: true },
      });
      await tx.assignmentSubmission.create({
        data: {
          schoolId,
          assignmentId: assignment.lessonItemId,
          studentId,
          bodyText: `my essay ${n}`,
          fileKey: key,
        },
      });
    }

    await tx.certificate.create({
      data: {
        schoolId,
        courseId,
        studentId,
        serial: 'PRIV-TEST-0001',
        courseTitle: 'Latin',
        // Denormalised at issue time — this is the copy that outlives the
        // account, and the reason erasure has to make a decision about it.
        studentName: STUDENT_NAME,
        schoolName: 'Privacy School',
        issuedBy: teacherId,
      },
    });
  });

  otherStudentId = await withTenant(
    (await asSuperAdmin((tx) => tx.school.findUniqueOrThrow({ where: { schoolCode: SCHOOL_B } })))
      .id,
    async (tx) => (await tx.user.findFirstOrThrow({ where: { email: OTHER_STUDENT } })).id
  );
});

afterAll(async () => {
  await asSuperAdmin(async (tx) => {
    // Certificates are ON DELETE RESTRICT against Course and User, so they go
    // first or the school delete fails.
    await tx.certificate.deleteMany({ where: { schoolId } });
    await tx.school.deleteMany({ where: { schoolCode: { in: [SCHOOL, SCHOOL_B] } } });
    await tx.user.deleteMany({ where: { email: OWNER } });
  });
  await prisma.$disconnect();
});

describe('GET /school-admin/users/:id/export', () => {
  it('returns the record, with the counts it claims', async () => {
    const res = await admin.get(`/api/v1/school-admin/users/${studentId}/export`);

    expect(res.status, res.text).toBe(200);
    expect(res.body.data.subject.email).toBe(STUDENT);
    expect(res.body.data.subject.name).toBe(STUDENT_NAME);
    expect(res.body.data.counts.enrollments).toBe(1);
    expect(res.body.data.counts.certificates).toBe(1);
    // The counts are a summary of the arrays, so they must agree with them —
    // otherwise a recipient reads the summary and trusts a number the payload
    // does not support.
    expect(res.body.data.enrollments).toHaveLength(res.body.data.counts.enrollments);
    expect(res.body.data.certificates).toHaveLength(res.body.data.counts.certificates);
  });

  it('never includes credentials, however transparent that would feel', async () => {
    const res = await admin.get(`/api/v1/school-admin/users/${studentId}/export`).expect(200);

    // Asserted against the serialised body, not the object: a field that
    // survives JSON.stringify is a field that left the building.
    const body = res.text;
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('twoFactorSecret');
    expect(body).not.toContain('$2b$'); // a bcrypt hash, by prefix
  });

  it('carries every category the schema attaches to a user', async () => {
    /*
     * A drift guard, not a coverage metric.
     *
     * The export is assembled by hand — deliberately, because a generic walk of
     * the schema would silently gain and lose tables. The cost of doing it by
     * hand is that a *new* user-linked table gets forgotten, and the failure is
     * invisible: the export still returns 200 and still looks complete.
     *
     * So this reads the relations off Prisma's own metadata and fails when one
     * is neither exported nor listed below as a deliberate omission. Someone
     * adding a table has to make a decision rather than not notice.
     */
    const userModel = Prisma.dmmf.datamodel.models.find((m) => m.name === 'User')!;
    const relations = userModel.fields.filter((f) => f.kind === 'object' && f.isList);

    const exported = new Set([
      'enrollments',
      'taughtClasses',
      'quizAttempts',
      'submissions',
      'certificates',
      'videoProgress',
      'videoEvents',
      'childLinks',
      'parentLinks',
      'auditLogs',
    ]);

    const deliberatelyOmitted = new Set([
      // Credentials and security machinery. Returning these would create a
      // disclosure risk in the name of transparency; none is data the subject
      // can act on.
      'refreshTokens',
      'recoveryCodes',
      'resetTokens',
      // Records *about other people* that this person happens to have touched.
      // A teacher's export must not contain their pupils' marks, and a course
      // is the school's asset rather than the creator's personal data.
      'gradedWork',
      'issuedCertificates',
      'createdCourses',
    ]);

    const unaccounted = relations
      .map((f) => f.name)
      .filter((n) => !exported.has(n) && !deliberatelyOmitted.has(n));

    expect(
      unaccounted,
      `New user-linked relation(s) with no decision recorded: ${unaccounted.join(', ')}. ` +
        'Add them to exportUser, or to deliberatelyOmitted with a reason.'
    ).toEqual([]);
  });

  it('cannot reach into another school', async () => {
    // 404 rather than 403, per the API-wide convention: a record you may not
    // read is reported as missing so its existence is not disclosed.
    const res = await admin.get(`/api/v1/school-admin/users/${otherStudentId}/export`);
    expect(res.status).toBe(404);
  });

  it('is refused to a teacher', async () => {
    const teacher = await login(request.agent(app), {
      schoolCode: SCHOOL,
      email: TEACHER,
      password: PASSWORD,
    });
    const res = await teacher.get(`/api/v1/school-admin/users/${studentId}/export`);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /school-admin/users/:id', () => {
  it('refuses to decide the certificate question on the school’s behalf', async () => {
    const res = await admin.delete(`/api/v1/school-admin/users/${studentId}`);

    expect(res.status, res.text).toBe(409);
    expect(res.body.message).toMatch(/revokeCertificates/);

    // And it must not have half-done the job while refusing.
    const still = await withTenant(schoolId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: studentId } })
    );
    expect(still.name).toBe(STUDENT_NAME);
    expect(still.erasedAt).toBeNull();
  });

  it('will not let an admin erase themselves', async () => {
    const res = await admin.delete(`/api/v1/school-admin/users/${adminId}?revokeCertificates=false`);
    expect(res.status).toBe(400);
  });

  it('erases, revokes the certificates, and reports what it did', async () => {
    const res = await admin.delete(
      `/api/v1/school-admin/users/${studentId}?revokeCertificates=true`
    );

    expect(res.status, res.text).toBe(200);
    const report = res.body.data;
    expect(report.certificates.revoked).toBe(1);
    expect(report.overwritten).toContain('email');
    // The records the school has to keep are reported as retained, not deleted.
    expect(report.retained.enrollments).toBe(1);
    expect(report.retained.certificates).toBe(1);

    // Uploaded coursework: two objects, one removable and one whose key S3
    // refuses. The report must show the split rather than rounding it to
    // success — this is the assertion the whole two-phase design exists for.
    expect(report.storage).toEqual({ total: 2, deleted: 1, failed: 1 });
    expect(report.note).toMatch(/could not be deleted/i);
  });

  it('detaches the file even when the object could not be removed', async () => {
    // Nothing in the product may still point at a pupil's file, whatever
    // happened in the bucket.
    const dangling = await withTenant(schoolId, (tx) =>
      tx.assignmentSubmission.count({ where: { studentId, fileKey: { not: null } } })
    );
    expect(dangling).toBe(0);

    // The submission row itself survives — it is an academic record.
    const kept = await withTenant(schoolId, (tx) =>
      tx.assignmentSubmission.count({ where: { studentId } })
    );
    expect(kept).toBe(2);
  });

  it('records the surviving object keys so the deletion can be retried', async () => {
    // Once the column is nulled, the audit log is the ONLY place that still
    // knows which objects belonged to this person. Without this the failure
    // would be unrecoverable as well as unreported.
    const entry = await withTenant(schoolId, (tx) =>
      tx.auditLog.findFirst({
        where: { action: 'USER_ERASED_STORAGE', entityId: studentId },
        orderBy: { createdAt: 'desc' },
      })
    );

    expect(entry, 'no storage-failure audit entry was written').toBeTruthy();
    expect(JSON.stringify(entry!.metadata ?? {})).toContain(FILE_KEY_BAD);
  });

  it('leaves the name nowhere to be found', async () => {
    // The assertion that matters, and it deliberately does not consult the
    // report — it goes back to the database and looks.
    const residue = await withTenant(schoolId, async (tx) => ({
      byName: await tx.user.count({ where: { name: STUDENT_NAME } }),
      byEmail: await tx.user.count({ where: { email: STUDENT } }),
      onCertificate: await tx.certificate.count({ where: { studentName: STUDENT_NAME } }),
    }));

    expect(residue.byName).toBe(0);
    expect(residue.byEmail).toBe(0);
    /*
     * The one that is NOT zero, on purpose.
     *
     * `certificates.student_name` is denormalised so the credential survives a
     * rename, which is exactly why erasure cannot reach it without destroying
     * the record. The mitigation is revocation — the public verifier now
     * reports this credential as revoked — and the residual name is a
     * documented consequence rather than an oversight. If this assertion ever
     * changes, `docs/DATA_RETENTION.md` §3 has to change with it.
     */
    expect(residue.onCertificate).toBe(1);
  });

  it('stops the person logging in', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: SCHOOL, email: STUDENT, password: PASSWORD });

    expect(res.status).toBe(401);
  });

  it('keeps the class roster and the academic record intact', async () => {
    const survived = await withTenant(schoolId, async (tx) => ({
      enrollments: await tx.enrollment.count({ where: { studentId } }),
      certificates: await tx.certificate.count({ where: { studentId } }),
      revoked: await tx.certificate.count({ where: { studentId, revokedAt: { not: null } } }),
    }));

    // A cascade would have taken all of these, and the class's history with
    // them. That is the reason this is an anonymisation and not a delete.
    expect(survived.enrollments).toBe(1);
    expect(survived.certificates).toBe(1);
    expect(survived.revoked).toBe(1);
  });

  it('writes the report to the audit log, so erasure is provable later', async () => {
    const entry = await withTenant(schoolId, (tx) =>
      tx.auditLog.findFirst({
        where: { action: 'USER_ERASED', entityId: studentId },
        orderBy: { createdAt: 'desc' },
      })
    );

    expect(entry, 'no audit entry was written').toBeTruthy();
    const metadata = entry!.metadata as Record<string, unknown>;
    expect(metadata.overwritten).toBeTruthy();
    expect(metadata.roleAtErasure).toBe('STUDENT');
  });

  it('refuses a second erasure rather than reporting a fresh one', async () => {
    const res = await admin.delete(
      `/api/v1/school-admin/users/${studentId}?revokeCertificates=true`
    );
    expect(res.status).toBe(409);
  });

  it('is refused to a teacher', async () => {
    const teacher = await login(request.agent(app), {
      schoolCode: SCHOOL,
      email: TEACHER,
      password: PASSWORD,
    });
    const res = await teacher.delete(`/api/v1/school-admin/users/${teacherId}`);
    expect(res.status).toBe(403);
  });

  it('cannot erase a user in another school', async () => {
    const res = await admin.delete(
      `/api/v1/school-admin/users/${otherStudentId}?revokeCertificates=false`
    );
    expect(res.status).toBe(404);

    // Positive control: that user is genuinely still there, so the 404 above
    // was tenant isolation rather than a bad id.
    const alive = await asSuperAdmin((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: otherStudentId } })
    );
    expect(alive.erasedAt).toBeNull();
  });
});
