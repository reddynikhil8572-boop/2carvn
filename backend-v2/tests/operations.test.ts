import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin, withTenant } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';
import { JOBS, expireStaleQuizAttempts, runAllJobsOnce } from '../src/services/scheduler.service';
import { setReady } from '../src/utils/readiness';

/**
 * Operational surface: housekeeping and observability.
 *
 * These exist because the failure mode of getting them wrong is *silence*. A
 * prune that never runs, a readiness probe that lies, a metrics label that
 * explodes into unbounded series — none of them produce an error anyone sees
 * until the consequence arrives.
 */

const PASSWORD = 'Passw0rd!x';
const SCHOOL = 'OPS-A';
const ids = { school: '', student: '', videoItem: '', quizItem: '' };

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);

  const school = await asSuperAdmin((tx) =>
    tx.school.create({ data: { schoolCode: SCHOOL, name: 'Ops School', plan: 'STANDARD' } })
  );
  ids.school = school.id;

  await withTenant(school.id, async (tx) => {
    const teacher = await tx.user.create({
      data: {
        schoolId: school.id,
        email: `t@${SCHOOL.toLowerCase()}.test`,
        passwordHash,
        name: 'T',
        role: 'TEACHER',
      },
    });
    const student = await tx.user.create({
      data: {
        schoolId: school.id,
        email: `s@${SCHOOL.toLowerCase()}.test`,
        passwordHash,
        name: 'S',
        role: 'STUDENT',
      },
    });
    ids.student = student.id;

    const course = await tx.course.create({
      data: { schoolId: school.id, title: 'Ops', slug: 'ops', createdBy: teacher.id },
    });
    const mod = await tx.module.create({
      data: { schoolId: school.id, courseId: course.id, title: 'M' },
    });
    const chapter = await tx.chapter.create({
      data: { schoolId: school.id, moduleId: mod.id, title: 'C' },
    });
    const lesson = await tx.lesson.create({
      data: { schoolId: school.id, chapterId: chapter.id, title: 'L' },
    });

    const video = await tx.lessonItem.create({
      data: {
        schoolId: school.id,
        lessonId: lesson.id,
        kind: 'VIDEO',
        title: 'V',
        video: { create: { schoolId: school.id, provider: 'YOUTUBE', durationSeconds: 600 } },
      },
    });
    ids.videoItem = video.id;

    const quiz = await tx.lessonItem.create({
      data: {
        schoolId: school.id,
        lessonId: lesson.id,
        kind: 'QUIZ',
        title: 'Q',
        quiz: { create: { schoolId: school.id, timeLimitMinutes: 5, maxAttempts: 5 } },
      },
    });
    ids.quizItem = quiz.id;
  });
});

afterAll(async () => {
  setReady(false);
  await asSuperAdmin((tx) => tx.school.deleteMany({ where: { schoolCode: SCHOOL } }));
  await prisma.$disconnect();
});

describe('health, readiness and metrics', () => {
  it('keeps liveness independent of the database', async () => {
    // If liveness depended on Postgres, a brief blip would get every replica
    // killed at once — a recoverable outage turned into a cold start.
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });

  it('reports not-ready before startup and during shutdown', async () => {
    setReady(false);
    const draining = await request(app).get('/ready');
    // 503 is what makes a load balancer stop sending work here.
    expect(draining.status).toBe(503);
    expect(draining.body.status).toBe('SHUTTING_DOWN');

    setReady(true);
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('READY');
  });

  it('returns a correlation id on every response and honours a sane inbound one', async () => {
    const generated = await request(app).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const passed = await request(app).get('/health').set('X-Request-Id', 'trace-abc_123');
    expect(passed.headers['x-request-id']).toBe('trace-abc_123');
  });

  it('replaces an inbound request id that does not match the allow-list', async () => {
    // The id is written into log output and reflected in a response header, so
    // it is allow-listed rather than sanitised. A literal newline cannot be
    // tested through an HTTP client — Node refuses to send it — so this uses
    // characters that ARE transmissible but still have no business in a log
    // field or a header value.
    const res = await request(app)
      .get('/health')
      .set('X-Request-Id', 'evil id with spaces <script>');

    expect(res.headers['x-request-id']).not.toContain('script');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    // Over-long ids are refused too: unbounded input reaching a log line is how
    // log files become the disk-space incident.
    const long = await request(app).get('/health').set('X-Request-Id', 'a'.repeat(500));
    expect(long.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes Prometheus metrics labelled by route pattern, not by URL', async () => {
    // One request against a parameterised route...
    await request(app).get(`/api/v1/courses/${ids.videoItem}`);

    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    // ...must appear as the pattern. The raw id as a label would be one series
    // per course, which is how a metrics endpoint becomes the outage.
    expect(res.text).toContain('route="/api/v1/courses/:id"');
    expect(res.text).not.toContain(ids.videoItem);

    expect(res.text).toContain('http_request_duration_seconds_bucket');
    expect(res.text).toContain('http_requests_in_flight');
  });

  it('labels routes in mounted routers with their full pattern', async () => {
    // The regression this pins: labels used to be read on the response's
    // 'finish' event, and Express restores req.baseUrl as the router stack
    // unwinds. Almost every controller here is async — it awaits, the stack
    // unwinds, and only then does it respond — so this endpoint was recorded
    // as `/:id/progress` while other requests to the same API recorded the
    // full pattern. One endpoint split across two series, which makes any
    // per-route alert quietly watch a fraction of its traffic.
    const student = request.agent(app);
    const login = await student
      .post('/api/v1/auth/login')
      .send({ schoolCode: SCHOOL, email: `s@${SCHOOL.toLowerCase()}.test`, password: PASSWORD });
    expect(login.status, login.text).toBe(200);

    // The status does not matter — this student is not enrolled, so the
    // course-access rule answers 404 (forbidden reads are indistinguishable
    // from missing ones). What matters is that a route *matched*, because that
    // is what makes a label observable. The assertion below is self-guarding:
    // had the path not matched at all, it would have been recorded as
    // `unmatched` and the expected label would simply be absent.
    await student.get(`/api/v1/items/${ids.videoItem}/progress`);

    const res = await request(app).get('/metrics');
    expect(res.text).toContain('route="/api/v1/items/:id/progress"');
    expect(res.text).not.toContain('route="/:id/progress"');
  });

  it('has no route label that is missing its mount prefix', async () => {
    // The invariant behind the test above, stated once so any future endpoint
    // is covered rather than only the one that happened to be noticed.
    const res = await request(app).get('/metrics');
    const labels = [...res.text.matchAll(/route="([^"]*)"/g)].map((m) => m[1]!);

    expect(labels.length).toBeGreaterThan(0);
    const bad = [...new Set(labels)].filter((l) => l !== 'unmatched' && !l.startsWith('/api/v1'));
    expect(bad, `route labels missing their mount prefix: ${bad.join(', ')}`).toEqual([]);
  });

  it('exposes readiness as a gauge, so it can be alerted on', async () => {
    // /ready returning 503 removes a pod from the load balancer, which is
    // correct and also completely silent: with several replicas, traffic keeps
    // working while capacity disappears. k8s/prometheus-rules.yaml alerts on
    // this series.
    setReady(true);
    await request(app).get('/ready');

    const res = await request(app).get('/metrics');
    expect(res.text).toContain('edusphere_ready 1');
  });

  it('collapses unmatched routes into a single series', async () => {
    for (const path of ['/api/v1/nope-1', '/api/v1/nope-2', '/api/v1/nope-3']) {
      await request(app).get(path);
    }

    const res = await request(app).get('/metrics');
    // A 404 flood must not be able to create unbounded label cardinality.
    expect(res.text).toContain('route="unmatched"');
    expect(res.text).not.toContain('nope-1');
  });
});

describe('housekeeping actually runs', () => {
  it('closes quiz attempts whose window has passed', async () => {
    const attempt = await withTenant(ids.school, (tx) =>
      tx.quizAttempt.create({
        data: {
          schoolId: ids.school,
          quizId: ids.quizItem,
          studentId: ids.student,
          attemptNumber: 1,
          startedAt: new Date(Date.now() - 60 * 60_000),
          // Expired an hour ago and never submitted — the tab was closed.
          expiresAt: new Date(Date.now() - 55 * 60_000),
        },
      })
    );

    const closed = await expireStaleQuizAttempts();
    expect(closed).toBeGreaterThanOrEqual(1);

    const after = await withTenant(ids.school, (tx) =>
      tx.quizAttempt.findUnique({ where: { id: attempt.id } })
    );
    // Left IN_PROGRESS, startAttempt would resume it and grade it EXPIRED the
    // moment the student submitted.
    expect(after?.status).toBe('EXPIRED');
  });

  it('will not let the application role delete video events', async () => {
    // Append-only is enforced by revoking DELETE from edusphere_app, not just by
    // omitting an RLS policy. This is what makes the retention sweep a separate
    // owner-credentialled script (src/scripts/pruneVideoEvents.ts) rather than a
    // scheduler job — the first attempt at putting it in the scheduler failed
    // here, which is the guarantee working.
    await withTenant(ids.school, (tx) =>
      tx.videoEvent.create({
        data: {
          schoolId: ids.school,
          lessonItemId: ids.videoItem,
          studentId: ids.student,
          type: 'HEARTBEAT',
          positionSeconds: 5,
        },
      })
    );

    await expect(
      asSuperAdmin((tx) => tx.$executeRaw`DELETE FROM video_events WHERE position_seconds = 5`)
    ).rejects.toThrow(/permission denied/i);
  });

  it('keeps video progress separate from the event log', async () => {
    await withTenant(ids.school, async (tx) => {
      await tx.videoEvent.create({
        data: {
          schoolId: ids.school,
          lessonItemId: ids.videoItem,
          studentId: ids.student,
          type: 'HEARTBEAT',
          positionSeconds: 10,
          occurredAt: new Date(Date.now() - 400 * 24 * 60 * 60_000), // ~13 months
        },
      });
      await tx.videoEvent.create({
        data: {
          schoolId: ids.school,
          lessonItemId: ids.videoItem,
          studentId: ids.student,
          type: 'HEARTBEAT',
          positionSeconds: 20,
        },
      });
      await tx.videoProgress.create({
        data: {
          schoolId: ids.school,
          lessonItemId: ids.videoItem,
          studentId: ids.student,
          watchedSeconds: 42,
          percentComplete: 7,
        },
      });
    });

    // Progress is not a log: it is the answer to "how far is this student" and
    // what §8 reads. Retention removes aged events; it must never touch these
    // figures, which is why they are separate tables rather than one.
    const progress = await withTenant(ids.school, (tx) =>
      tx.videoProgress.findFirst({ where: { lessonItemId: ids.videoItem } })
    );
    expect(progress?.watchedSeconds).toBe(42);

    const events = await withTenant(ids.school, (tx) =>
      tx.videoEvent.findMany({ where: { lessonItemId: ids.videoItem } })
    );
    // Both the aged and the recent event are still here — nothing in the API's
    // reach can remove them, which is the point.
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it('declares a job for every piece of housekeeping that was previously never called', async () => {
    const names = JOBS.map((job) => job.name);
    // pruneExpired and pruneResetTokens existed for days with no caller.
    expect(names).toContain('prune-refresh-tokens');
    expect(names).toContain('prune-reset-tokens');
    expect(names).toContain('expire-quiz-attempts');

    // video_events retention is deliberately absent: the API role cannot delete
    // from an append-only table, so that sweep runs as an owner-credentialled
    // one-shot instead. Asserted so a future change does not quietly move it
    // back in and grant DELETE to make it work.
    expect(names).not.toContain('prune-video-events');

    // A lock that expires before the job finishes lets a second replica start a
    // duplicate — the exact thing the lock exists to prevent.
    for (const job of JOBS) {
      expect(job.lockMs, `${job.name} lock is too short to be useful`).toBeGreaterThan(30_000);
      expect(job.everyMs, `${job.name} interval is implausible`).toBeGreaterThan(60_000);
    }
  });

  it('runs every job without throwing, and counts them', async () => {
    await runAllJobsOnce();

    const res = await request(app).get('/metrics');
    // "Has the prune been failing for a week?" should be answerable from
    // metrics, not log archaeology.
    expect(res.text).toContain('scheduler_job_runs_total');
    expect(res.text).toContain('outcome="success"');
  });
});
