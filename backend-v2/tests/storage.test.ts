import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin, withTenant } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';
import { confirmUpload, storageAvailable } from '../src/services/storage.service';
import { scanningEnabled } from '../src/services/malwareScan.service';

/**
 * Object storage, against a real S3 (MinIO) rather than a mock.
 *
 * Mocking here would defeat the point: most of what can go wrong lives in the
 * presign policy and the signature, and neither exists in a mock. The compose
 * `minio` service and the CI service both provide the bucket.
 */

const PASSWORD = 'Passw0rd!x';
const SCHOOL = 'ST-A';

const ids = {
  school: '',
  klass: '',
  courseId: '',
  videoItem: '',
  /// A second video, used for the "duration could not be read" path so it does
  /// not disturb the first item's figures.
  unknownDurationItem: '',
  assignmentItem: '',
  fileAssignmentItem: '',
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

/**
 * Performs the browser's half of the upload: POST the presigned form plus the
 * bytes, straight to storage, without going near the API.
 */
const uploadTo = async (
  presigned: { url: string; fields: Record<string, string> },
  body: Buffer,
  contentType: string
): Promise<number> => {
  const form = new FormData();
  for (const [name, value] of Object.entries(presigned.fields)) form.append(name, value);
  form.append('file', new Blob([new Uint8Array(body)], { type: contentType }));

  const res = await fetch(presigned.url, { method: 'POST', body: form });
  return res.status;
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);

  const school = await asSuperAdmin((tx) =>
    tx.school.create({
      data: { schoolCode: SCHOOL, name: 'Storage School', plan: 'STANDARD', studentCap: 2000 },
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
  const course = await teacher.post('/api/v1/courses').send({ title: 'Media' });
  ids.courseId = course.body.data.id;

  const tree = await teacher.get(`/api/v1/courses/${ids.courseId}`);
  const chapterId = tree.body.data.modules[0].chapters[0].id;
  const lesson = await teacher
    .post(`/api/v1/chapters/${chapterId}/lessons`)
    .send({ title: 'Files' });

  const video = await teacher
    .post(`/api/v1/lessons/${lesson.body.data.id}/items`)
    .send({ kind: 'VIDEO', title: 'Lesson video', isPublished: true, provider: 'UPLOAD' });
  ids.videoItem = video.body.data.id;

  const unknown = await teacher
    .post(`/api/v1/lessons/${lesson.body.data.id}/items`)
    .send({ kind: 'VIDEO', title: 'Unparseable container', isPublished: true, provider: 'UPLOAD' });
  ids.unknownDurationItem = unknown.body.data.id;

  const textOnly = await teacher
    .post(`/api/v1/lessons/${lesson.body.data.id}/items`)
    .send({ kind: 'ASSIGNMENT', title: 'Text only', isPublished: true, maxPoints: 10 });
  ids.assignmentItem = textOnly.body.data.id;

  const withFile = await teacher.post(`/api/v1/lessons/${lesson.body.data.id}/items`).send({
    kind: 'ASSIGNMENT',
    title: 'Attach a file',
    isPublished: true,
    maxPoints: 10,
    allowsFile: true,
  });
  ids.fileAssignmentItem = withFile.body.data.id;

  await teacher.patch(`/api/v1/courses/${ids.courseId}`).send({ status: 'PUBLISHED' });
  await teacher.post(`/api/v1/courses/${ids.courseId}/classes`).send({ classId: ids.klass });
});

afterAll(async () => {
  await asSuperAdmin((tx) => tx.school.deleteMany({ where: { schoolCode: SCHOOL } }));
  await prisma.$disconnect();
});

describe('storage configuration', () => {
  it('is available to the suite, or everything below is vacuous', () => {
    // The same shape as rls.test.ts asserting the role is not a superuser:
    // without this, an unconfigured environment would make the tests pass by
    // never exercising storage at all.
    expect(
      storageAvailable(),
      'S3 is not configured — start the compose stack (docker compose up -d minio)'
    ).toBe(true);
  });
});

describe('the server names every key', () => {
  it('issues a key under the caller’s own school prefix', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher
      .post(`/api/v1/items/${ids.videoItem}/video/upload-url`)
      .send({ contentType: 'video/mp4' });

    expect(res.status, res.text).toBe(200);
    expect(res.body.data.key).toMatch(new RegExp(`^schools/${ids.school}/videos/[0-9a-f-]+\\.mp4$`));
    expect(res.body.data.url).toBeTruthy();
    expect(res.body.data.fields).toBeTruthy();
  });

  it('does not accept a key from the client', async () => {
    const teacher = await signIn(teacherEmail);

    // The presign body is `.strict()` and has no key field, so an attempt to
    // supply one is refused rather than ignored.
    const res = await teacher
      .post(`/api/v1/items/${ids.videoItem}/video/upload-url`)
      .send({ contentType: 'video/mp4', key: 'schools/other/videos/mine.mp4' });

    expect(res.status).toBe(422);
  });

  it('refuses to confirm a key naming another school', async () => {
    const teacher = await signIn(teacherEmail);
    const foreign = `schools/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/videos/x.mp4`;

    const res = await teacher
      .post(`/api/v1/items/${ids.videoItem}/video/confirm`)
      .send({ key: foreign, durationSeconds: 60 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong to this school/i);
  });

  it('rejects a content type outside the allow-list for that kind', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher
      .post(`/api/v1/items/${ids.videoItem}/video/upload-url`)
      .send({ contentType: 'text/html' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not an accepted type/i);
  });
});

describe('confirm proves the object exists', () => {
  it('refuses a key that was never uploaded, and writes no column', async () => {
    const teacher = await signIn(teacherEmail);

    const presigned = await teacher
      .post(`/api/v1/items/${ids.videoItem}/video/upload-url`)
      .send({ contentType: 'video/mp4' });

    // Skip the upload entirely and claim it happened.
    const res = await teacher
      .post(`/api/v1/items/${ids.videoItem}/video/confirm`)
      .send({ key: presigned.body.data.key, durationSeconds: 120 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/never uploaded/i);

    const asset = await withTenant(ids.school, (tx) =>
      tx.videoAsset.findUnique({ where: { lessonItemId: ids.videoItem } })
    );
    // A claimed upload must not leave a row pointing at nothing.
    expect(asset?.storageKey).toBeNull();
  });

  it('attaches the video once the object is really there', async () => {
    const teacher = await signIn(teacherEmail);

    const presigned = await teacher
      .post(`/api/v1/items/${ids.videoItem}/video/upload-url`)
      .send({ contentType: 'video/mp4' });

    const status = await uploadTo(presigned.body.data, Buffer.from('fake mp4 bytes'), 'video/mp4');
    expect(status, 'presigned POST to storage failed').toBeLessThan(300);

    const res = await teacher
      .post(`/api/v1/items/${ids.videoItem}/video/confirm`)
      .send({ key: presigned.body.data.key, durationSeconds: 600 });

    expect(res.status, res.text).toBe(200);
    expect(res.body.data.storageKey).toBe(presigned.body.data.key);
    expect(res.body.data.provider).toBe('UPLOAD');
    // §7 divides by this, so an uploaded video without it makes every
    // completion percentage meaningless.
    expect(res.body.data.durationSeconds).toBe(600);
  });

  it('demands the duration field, but accepts null for it', async () => {
    const teacher = await signIn(teacherEmail);

    // Omitting it entirely is a client bug worth surfacing.
    const missing = await teacher
      .post(`/api/v1/items/${ids.videoItem}/video/confirm`)
      .send({ key: `schools/${ids.school}/videos/whatever.mp4` });
    expect(missing.status).toBe(422);

    // Explicit null is legitimate: the browser could not parse the container.
    // Accepting it is what stops a client inventing a number — a duration of 1
    // would mark every student complete after a second, which is much worse
    // than having no percentage at all.
    //
    // A separate item, so this does not overwrite the duration the tests below
    // depend on.
    const presigned = await teacher
      .post(`/api/v1/items/${ids.unknownDurationItem}/video/upload-url`)
      .send({ contentType: 'video/webm' });
    await uploadTo(presigned.body.data, Buffer.from('webm bytes'), 'video/webm');

    const nulled = await teacher
      .post(`/api/v1/items/${ids.unknownDurationItem}/video/confirm`)
      .send({ key: presigned.body.data.key, durationSeconds: null });
    expect(nulled.status, nulled.text).toBe(200);
    expect(nulled.body.data.durationSeconds).toBeNull();
  });

  it('reports 0% and never completes when the duration is unknown', async () => {
    // The honest consequence of a null duration: visibly unavailable rather
    // than confidently wrong.
    const student = await signIn(studentEmail);

    const res = await student
      .post(`/api/v1/items/${ids.unknownDurationItem}/progress`)
      .send({ positionSeconds: 300, watchedSecondsDelta: 15, intervalSeconds: 15 });

    expect(res.status).toBe(200);
    expect(res.body.data.watchedSeconds).toBe(15);
    expect(res.body.data.percentComplete).toBe(0);
    expect(res.body.data.completedAt).toBeNull();
  });
});

describe('the presign policy is enforced by storage, not by us', () => {
  it('rejects a body larger than the policy allows', async () => {
    const student = await signIn(studentEmail);

    const presigned = await student
      .post(`/api/v1/items/${ids.fileAssignmentItem}/submissions/upload-url`)
      .send({ contentType: 'text/plain' });
    expect(presigned.status, presigned.text).toBe(200);

    // 25 MB cap for a submission; send 26.
    const tooBig = Buffer.alloc(26 * 1024 * 1024, 0x41);
    const status = await uploadTo(presigned.body.data, tooBig, 'text/plain');

    // Storage refuses it — this is why the upload is a presigned POST with
    // conditions rather than a bare presigned PUT.
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a tampered Content-Type field', async () => {
    const student = await signIn(studentEmail);

    const presigned = await student
      .post(`/api/v1/items/${ids.fileAssignmentItem}/submissions/upload-url`)
      .send({ contentType: 'application/pdf' });

    // The signed policy contains ['eq', '$Content-Type', 'application/pdf'].
    // S3 takes the object's content type from this FORM FIELD, so swapping it
    // is the only way a client could change what the file is stored as — and
    // the condition is what refuses it.
    //
    // (Lying only in the multipart part header is harmless for the same
    // reason: the stored type comes from the signed field, not the part.)
    const form = new FormData();
    for (const [name, value] of Object.entries(
      presigned.body.data.fields as Record<string, string>
    )) {
      form.append(name, name === 'Content-Type' ? 'text/html' : value);
    }
    form.append('file', new Blob([new Uint8Array(Buffer.from('<b>x</b>'))]));

    const res = await fetch(presigned.body.data.url, { method: 'POST', body: form });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('stores the file as the type the server signed, whatever the client claims', async () => {
    const student = await signIn(studentEmail);

    const presigned = await student
      .post(`/api/v1/items/${ids.fileAssignmentItem}/submissions/upload-url`)
      .send({ contentType: 'application/pdf' });

    // HTML bytes, labelled text/html on the part. The upload succeeds, and
    // that is fine — what matters is that it lands as application/pdf, so it
    // can never be served back as an executable document.
    const status = await uploadTo(
      presigned.body.data,
      Buffer.from('<script>alert(1)</script>'),
      'text/html'
    );
    expect(status).toBeLessThan(300);

    const stored = await confirmUpload(presigned.body.data.key, ids.school);
    expect(stored.contentType).toBe('application/pdf');
  });
});

describe('malware scanning', () => {
  /**
   * EICAR — the industry-standard *harmless* test string that every scanner is
   * required to detect. Split so this source file does not itself trip a
   * scanner watching the repository, which is the traditional way this test
   * causes a confusing CI failure.
   */
  const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR', '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(
    ''
  );

  it.skipIf(!scanningEnabled())('rejects an infected upload and removes the object', async () => {
    const student = await signIn(studentEmail);

    const presigned = await student
      .post(`/api/v1/items/${ids.fileAssignmentItem}/submissions/upload-url`)
      .send({ contentType: 'text/plain' });

    const uploaded = await uploadTo(presigned.body.data, Buffer.from(EICAR), 'text/plain');
    expect(uploaded).toBeLessThan(300); // storage accepts it; the scanner is the gate

    const submitted = await student
      .post(`/api/v1/items/${ids.fileAssignmentItem}/submissions`)
      .send({ bodyText: 'Here you go', fileKey: presigned.body.data.key });

    expect(submitted.status).toBe(422);
    expect(submitted.body.message).toMatch(/virus scanner/i);

    // Rejecting is not enough: an unreferenced object left in the bucket is
    // still downloadable by anyone who learns its key.
    await expect(confirmUpload(presigned.body.data.key, ids.school, { scan: false })).rejects.toThrow(
      /never uploaded/i
    );
  });

  it('says plainly whether scanning is on', () => {
    // Not configured is a decision; configured-but-broken is an incident. This
    // test exists so a suite run makes clear which state it ran in, rather than
    // silently skipping and implying coverage that was not exercised.
    if (!scanningEnabled()) {
      expect(process.env.CLAMAV_HOST || '').toBe('');
    } else {
      expect(process.env.CLAMAV_HOST).toBeTruthy();
    }
  });
});

describe('who may reach a file', () => {
  it('lets an enrolled student get a playable URL whose bytes actually come back', async () => {
    const student = await signIn(studentEmail);

    const res = await student.get(`/api/v1/items/${ids.videoItem}/video/url`);
    expect(res.status).toBe(200);
    expect(res.body.data.external).toBe(false);
    expect(res.body.data.url).toContain('X-Amz-Signature');
    expect(res.body.data.durationSeconds).toBe(600);

    // Fetching it is the part that matters. A URL that merely *looks* signed
    // proves nothing: SigV4 signs the `host` header, so an implementation that
    // signs for one endpoint and rewrites the host afterwards produces a
    // plausible-looking URL that returns SignatureDoesNotMatch. That is
    // exactly the bug this assertion caught.
    const fetched = await fetch(res.body.data.url);
    expect(fetched.status, 'signed GET was rejected by storage').toBe(200);
    expect(await fetched.text()).toBe('fake mp4 bytes');
  });

  it('refuses a student outside the course', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    await withTenant(ids.school, async (tx) => {
      const klass = await tx.class.create({
        data: { schoolId: ids.school, name: 'Y12', academicYear: '2026' },
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
    const res = await outsider.get(`/api/v1/items/${ids.videoItem}/video/url`);
    expect(res.status).toBe(404);
  });

  it('does not let a classmate download another student’s attachment', async () => {
    const student = await signIn(studentEmail);

    const presigned = await student
      .post(`/api/v1/items/${ids.fileAssignmentItem}/submissions/upload-url`)
      .send({ contentType: 'application/pdf' });
    await uploadTo(presigned.body.data, Buffer.from('%PDF-1.4 essay'), 'application/pdf');

    const submitted = await student
      .post(`/api/v1/items/${ids.fileAssignmentItem}/submissions`)
      .send({ bodyText: 'See attached.', fileKey: presigned.body.data.key });
    expect(submitted.status, submitted.text).toBe(201);
    expect(submitted.body.data.fileKey).toBe(presigned.body.data.key);

    const own = await student.get(`/api/v1/submissions/${submitted.body.data.id}/file`);
    expect(own.status).toBe(200);
    // attachment, not inline: an uploaded HTML or SVG rendered in the origin's
    // context would be stored XSS.
    expect(decodeURIComponent(own.body.data.url)).toContain('attachment');

    const peer = await signIn(peerEmail);
    const stolen = await peer.get(`/api/v1/submissions/${submitted.body.data.id}/file`);
    expect(stolen.status).toBe(404);

    // Staff may, which is what makes marking possible.
    const teacher = await signIn(teacherEmail);
    expect((await teacher.get(`/api/v1/submissions/${submitted.body.data.id}/file`)).status).toBe(
      200
    );
  });
});

describe('allowsFile actually gates', () => {
  it('refuses a presign for an assignment that does not accept files', async () => {
    const student = await signIn(studentEmail);

    const res = await student
      .post(`/api/v1/items/${ids.assignmentItem}/submissions/upload-url`)
      .send({ contentType: 'application/pdf' });

    // Refused at the presign, not only at the submit — handing out an upload
    // URL and then rejecting the submission wastes the student's upload.
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not accept file/i);
  });

  it('refuses a file submission to a text-only assignment', async () => {
    const student = await signIn(studentEmail);

    const res = await student
      .post(`/api/v1/items/${ids.assignmentItem}/submissions`)
      .send({ bodyText: 'x', fileKey: `schools/${ids.school}/submissions/forged.pdf` });

    expect(res.status).toBe(400);
  });

  it('does not let staff upload a submission', async () => {
    const teacher = await signIn(teacherEmail);

    const res = await teacher
      .post(`/api/v1/items/${ids.fileAssignmentItem}/submissions/upload-url`)
      .send({ contentType: 'application/pdf' });

    expect(res.status).toBe(403);
  });
});

describe('§7 finally has something to measure', () => {
  it('accrues clamped progress against an uploaded video', async () => {
    const student = await signIn(studentEmail);

    const first = await student
      .post(`/api/v1/items/${ids.videoItem}/progress`)
      .send({ positionSeconds: 15, watchedSecondsDelta: 15, intervalSeconds: 15 });
    expect(first.status, first.text).toBe(200);
    expect(first.body.data.watchedSeconds).toBe(15);
    // Duration came from the confirm step, so a percentage is meaningful now.
    expect(first.body.data.percentComplete).toBe(3); // 15/600

    const inflated = await student
      .post(`/api/v1/items/${ids.videoItem}/progress`)
      .send({ positionSeconds: 600, watchedSecondsDelta: 600, intervalSeconds: 15 });
    expect(inflated.body.data.watchedSeconds).toBeLessThan(120);
  });
});
