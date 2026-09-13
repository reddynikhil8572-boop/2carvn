import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin, withTenant } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';

/**
 * Requirements §7 — video tracking, and §8's roll-up over it.
 *
 * The test that carries this increment is the clamp. Watch time is the one
 * self-report in the product that cannot be moved to the server — only the
 * browser knows where the playhead is — so the guarantee is not "the client is
 * honest" but "the client cannot be credited more time than has actually
 * passed". That is what these assert.
 */

const PASSWORD = 'Passw0rd!x';
const SCHOOL = 'VT-A';
const DURATION = 600; // 10 minutes

const ids = { school: '', klass: '', courseId: '', videoItem: '' };

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
      data: { schoolCode: SCHOOL, name: 'Video Academy', plan: 'STANDARD', studentCap: 2000 },
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
  const course = await teacher.post('/api/v1/courses').send({ title: 'Geology' });
  ids.courseId = course.body.data.id;

  const tree = await teacher.get(`/api/v1/courses/${ids.courseId}`);
  const chapterId = tree.body.data.modules[0].chapters[0].id;
  const lesson = await teacher
    .post(`/api/v1/chapters/${chapterId}/lessons`)
    .send({ title: 'Rocks' });

  const item = await teacher.post(`/api/v1/lessons/${lesson.body.data.id}/items`).send({
    kind: 'VIDEO',
    title: 'Igneous rocks',
    isPublished: true,
    provider: 'YOUTUBE',
    externalUrl: 'https://example.com/v',
  });
  ids.videoItem = item.body.data.id;

  // Duration is what percent-complete is measured against, so it has to be
  // known for completion to mean anything.
  await withTenant(ids.school, (tx) =>
    tx.videoAsset.update({
      where: { lessonItemId: ids.videoItem },
      data: { durationSeconds: DURATION },
    })
  );

  await teacher.patch(`/api/v1/courses/${ids.courseId}`).send({ status: 'PUBLISHED' });
  await teacher.post(`/api/v1/courses/${ids.courseId}/classes`).send({ classId: ids.klass });
});

afterAll(async () => {
  await asSuperAdmin((tx) => tx.school.deleteMany({ where: { schoolCode: SCHOOL } }));
  await prisma.$disconnect();
});

describe('the watch-time clamp', () => {
  it('credits a plausible first heartbeat', async () => {
    const student = await signIn(studentEmail);

    const res = await student.post(`/api/v1/items/${ids.videoItem}/progress`).send({
      type: 'HEARTBEAT',
      positionSeconds: 15,
      watchedSecondsDelta: 15,
      intervalSeconds: 15,
      playbackRate: 1,
      device: 'vitest',
    });

    expect(res.status, res.text).toBe(200);
    expect(res.body.data.watchedSeconds).toBe(15);
    expect(res.body.data.lastPositionSeconds).toBe(15);
    expect(res.body.data.percentComplete).toBe(3); // 15/600
    expect(res.body.data.completedAt).toBeNull();
  });

  it('refuses to credit more time than has actually elapsed', async () => {
    const student = await signIn(studentEmail);

    // The whole video's worth, claimed immediately after the last heartbeat.
    const res = await student.post(`/api/v1/items/${ids.videoItem}/progress`).send({
      positionSeconds: 600,
      watchedSecondsDelta: 600,
      intervalSeconds: 15,
    });

    expect(res.status).toBe(200);
    // Only a second or two of real time has passed, so the credit is a
    // handful of seconds — nothing like the 600 claimed.
    const credited = res.body.data.watchedSeconds - 15;
    expect(credited).toBeLessThan(60);
    expect(res.body.data.watchedSeconds).toBeLessThan(100);
  });

  it('does not mark a video complete just because the scrubber reached the end', async () => {
    const student = await signIn(studentEmail);

    // Position is at 100%, but almost no time has been credited.
    const progress = await student.get(`/api/v1/items/${ids.videoItem}/progress`);

    expect(progress.body.data.percentComplete).toBe(100);
    // Completion needs BOTH position and enough credited watch time, or
    // dragging to the end would finish every video instantly.
    expect(progress.body.data.completedAt).toBeNull();
  });

  it('records the raw claim beside what was credited', async () => {
    // The gap between the two is the audit trail for a progress row that
    // looks wrong later.
    const events = await withTenant(ids.school, (tx) =>
      tx.videoEvent.findMany({
        where: { lessonItemId: ids.videoItem },
        orderBy: { occurredAt: 'asc' },
      })
    );

    const inflated = events.find((e) => e.claimedSeconds === 600);
    expect(inflated).toBeTruthy();
    expect(inflated!.creditedSeconds).toBeLessThan(600);
    expect(inflated!.creditedSeconds!).toBeLessThanOrEqual(inflated!.claimedSeconds!);
  });

  it('keeps the furthest position when the student rewinds', async () => {
    const student = await signIn(studentEmail);

    const res = await student.post(`/api/v1/items/${ids.videoItem}/progress`).send({
      type: 'SEEK',
      positionSeconds: 100,
      watchedSecondsDelta: 0,
    });

    expect(res.body.data.lastPositionSeconds).toBe(100);
    // Rewinding moves where you are, not how far you got.
    expect(res.body.data.furthestPositionSeconds).toBe(600);
    // A big backwards jump is the only "replay" signal a player gives us.
    expect(res.body.data.replayCount).toBe(1);
  });

  it('rejects a client trying to state when the heartbeat happened', async () => {
    const student = await signIn(studentEmail);

    const res = await student.post(`/api/v1/items/${ids.videoItem}/progress`).send({
      positionSeconds: 200,
      watchedSecondsDelta: 10,
      occurredAt: new Date(0).toISOString(),
    });

    // The schema is strict. A client that could name its own previous
    // heartbeat time could manufacture an arbitrary credit budget.
    expect(res.status).toBe(422);
  });
});

describe('who may see progress', () => {
  it('does not let a classmate read someone else’s progress', async () => {
    const peer = await signIn(peerEmail);

    // Same school, so RLS returns rows happily; only the service check stands
    // between classmates, as with grades.
    const own = await peer.get(`/api/v1/items/${ids.videoItem}/progress`);
    expect(own.status).toBe(200);
    expect(own.body.data).toBeNull(); // they have not watched it

    const all = await peer.get(`/api/v1/items/${ids.videoItem}/progress/all`);
    expect(all.status).toBe(403);
  });

  it('lets staff read the whole class', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher.get(`/api/v1/items/${ids.videoItem}/progress/all`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].student.name).toBe(studentEmail);
  });

  it('does not track staff as though they were students', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher
      .post(`/api/v1/items/${ids.videoItem}/progress`)
      .send({ positionSeconds: 10, watchedSecondsDelta: 10 });

    // A teacher previewing content would otherwise pollute the class figures.
    expect(res.status).toBe(403);
  });

  it('refuses progress against a video from a course the student was not given', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    await withTenant(ids.school, async (tx) => {
      const klass = await tx.class.create({
        data: { schoolId: ids.school, name: 'Y11', academicYear: '2026' },
      });
      const outsider = await tx.user.create({
        data: {
          schoolId: ids.school,
          email: `outsider@${SCHOOL.toLowerCase()}.test`,
          passwordHash,
          name: 'Outsider',
          role: 'STUDENT',
        },
      });
      await tx.enrollment.create({
        data: { schoolId: ids.school, classId: klass.id, studentId: outsider.id },
      });
    });

    const outsider = await signIn(`outsider@${SCHOOL.toLowerCase()}.test`);
    const res = await outsider
      .post(`/api/v1/items/${ids.videoItem}/progress`)
      .send({ positionSeconds: 10, watchedSecondsDelta: 10 });

    expect(res.status).toBe(404);
  });
});

describe('the event log is append-only', () => {
  it('cannot be updated or deleted', async () => {
    const before = await withTenant(ids.school, (tx) =>
      tx.videoEvent.count({ where: { lessonItemId: ids.videoItem } })
    );
    expect(before).toBeGreaterThan(0);

    // UPDATE and DELETE privileges are revoked outright, so these raise rather
    // than silently affecting zero rows the way an RLS-only omission would.
    await expect(
      withTenant(ids.school, (tx) =>
        tx.videoEvent.updateMany({
          where: { lessonItemId: ids.videoItem },
          data: { positionSeconds: 0 },
        })
      )
    ).rejects.toThrow();

    await expect(
      withTenant(ids.school, (tx) =>
        tx.videoEvent.deleteMany({ where: { lessonItemId: ids.videoItem } })
      )
    ).rejects.toThrow();

    const after = await withTenant(ids.school, (tx) =>
      tx.videoEvent.count({ where: { lessonItemId: ids.videoItem } })
    );
    expect(after).toBe(before);
  });
});

describe('§8 course analytics', () => {
  it('reports started, completed and the audience it is measured against', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher.get(`/api/v1/courses/${ids.courseId}/analytics/video`);
    expect(res.status).toBe(200);

    // "3 finished" is meaningless without a denominator.
    expect(res.body.data.audience).toBeGreaterThanOrEqual(2);
    expect(res.body.data.videos).toHaveLength(1);

    const video = res.body.data.videos[0];
    expect(video.durationSeconds).toBe(DURATION);
    expect(video.started).toBe(1);
    expect(video.completed).toBe(0);
    expect(video.averagePercent).toBe(100);
  });

  it('is not readable by a student', async () => {
    const student = await signIn(studentEmail);
    const res = await student.get(`/api/v1/courses/${ids.courseId}/analytics/video`);
    expect(res.status).toBe(403);
  });
});
