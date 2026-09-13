import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';

/**
 * Cross-site request forgery, which this API defends against by parsing
 * exactly one content type.
 *
 * The exposure was real and was found on 2026-08-07 while verifying cookies
 * over TLS. Production cookies are `SameSite=None` — the API and the web app
 * are separately hosted, so they have to be — which means the browser attaches
 * them to cross-site requests. A cross-origin form POST is a CORS "simple
 * request": no preflight, so CORS never gets a veto, and refusing to hand the
 * attacker the *response* is no comfort once the write has landed.
 *
 * `express.urlencoded` was mounted with nothing using it (uploads are
 * presigned POSTs straight to object storage). That made every state-changing
 * endpoint with an all-strings body — creating a user, for one — submittable
 * from a form on any page a signed-in school admin visited.
 *
 * The fix is the absence of a parser, and absences are easy to undo by
 * accident. Hence these tests.
 */

const PASSWORD = 'Passw0rd!x';
const OWNER_EMAIL = 'owner@csrf.test';
const SCHOOL = 'CSRF-A';

let adminAgent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await asSuperAdmin(async (tx) => {
    await tx.user.create({
      data: { email: OWNER_EMAIL, passwordHash, name: 'Owner', role: 'SUPER_ADMIN' },
    });
  });

  const owner = request.agent(app);
  const login = await owner.post('/api/v1/auth/login').send({
    email: OWNER_EMAIL,
    password: PASSWORD,
  });
  expect(login.status, login.text).toBe(200);

  const created = await owner.post('/api/v1/super-admin/schools').send({
    schoolCode: SCHOOL,
    name: 'CSRF Academy',
    admin: { email: 'admin@csrf.test', name: 'CSRF Admin', password: PASSWORD },
  });
  expect(created.status, created.text).toBe(201);

  adminAgent = request.agent(app);
  const adminLogin = await adminAgent.post('/api/v1/auth/login').send({
    schoolCode: SCHOOL,
    email: 'admin@csrf.test',
    password: PASSWORD,
  });
  expect(adminLogin.status, adminLogin.text).toBe(200);
});

afterAll(async () => {
  await asSuperAdmin(async (tx) => {
    await tx.school.deleteMany({ where: { schoolCode: SCHOOL } });
    await tx.user.deleteMany({ where: { email: OWNER_EMAIL } });
  });
  await prisma.$disconnect();
});

/**
 * The content types a browser can send cross-site with no preflight. If any of
 * these reaches a handler with a populated body, a malicious page can drive
 * this API using a logged-in user's cookies.
 */
const SIMPLE_CONTENT_TYPES = [
  'application/x-www-form-urlencoded',
  'text/plain',
  'multipart/form-data; boundary=----x',
];

describe('cross-site form submissions', () => {
  it('the session used here is genuinely authenticated', async () => {
    // Without this, every rejection below could be a plain 401 and the suite
    // would pass against an API with no CSRF protection whatsoever.
    const res = await adminAgent.get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('admin@csrf.test');
  });

  it('and it CAN create a user when the request is JSON', async () => {
    const res = await adminAgent.post('/api/v1/school-admin/users').send({
      email: 'legit@csrf.test',
      name: 'Legitimately Created',
      role: 'STUDENT',
      password: PASSWORD,
    });
    expect(res.status, res.text).toBe(201);
  });

  it.each(SIMPLE_CONTENT_TYPES)('rejects a credentialed %s POST', async (contentType) => {
    const res = await adminAgent
      .post('/api/v1/school-admin/users')
      .set('Content-Type', contentType)
      .send('email=attacker@csrf.test&name=Attacker&role=SCHOOL_ADMIN&password=Passw0rd!x');

    // 422 from validation seeing no body at all. Not 201, and not 500 —
    // an unparsed body must reach the validator, not blow up a handler.
    expect(res.status, `body was parsed as ${contentType}: ${res.text}`).toBe(422);
  });

  it('creates nothing as a result of those attempts', async () => {
    // The status assertions above would still pass if a handler rejected the
    // response while having already written the row.
    const attacker = await asSuperAdmin((tx) =>
      tx.user.findFirst({ where: { email: 'attacker@csrf.test' } })
    );
    expect(attacker).toBeNull();
  });
});
