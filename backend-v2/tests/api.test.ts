import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';

/**
 * The Phase 1 flow over HTTP, in-process via supertest. Complements rls.test.ts:
 * that one proves the database boundary, this one proves the routes, roles and
 * session handling sitting in front of it.
 */

const PASSWORD = 'Passw0rd!x';
const OWNER_EMAIL = 'owner@api.test';
const SHARED_STUDENT = 'shared@api.test';

const agent = () => request.agent(app);

/** Signs in and returns an agent carrying the session cookies. */
const signIn = async (schoolCode: string, email: string, password = PASSWORD) => {
  const a = agent();
  const res = await a.post('/api/v1/auth/login').send({ schoolCode, email, password });
  expect(res.status, `login failed for ${email}: ${res.text}`).toBe(200);
  return a;
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);

  await asSuperAdmin(async (tx) => {
    await tx.user.create({
      data: { email: OWNER_EMAIL, passwordHash, name: 'Platform Owner', role: 'SUPER_ADMIN' },
    });
  });
});

afterAll(async () => {
  await asSuperAdmin(async (tx) => {
    await tx.school.deleteMany({ where: { schoolCode: { in: ['API-A', 'API-B'] } } });
    await tx.user.deleteMany({ where: { email: OWNER_EMAIL } });
  });
  await prisma.$disconnect();
});

describe('school provisioning', () => {
  it('lets the platform owner sign in without a school code', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER_EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('SUPER_ADMIN');
    expect(res.body.data.user.schoolId).toBeNull();
  });

  it('creates schools with their first admin, and rejects a duplicate code as 409', async () => {
    const owner = await signIn('', OWNER_EMAIL);

    const a = await owner.post('/api/v1/super-admin/schools').send({
      schoolCode: 'API-A',
      name: 'Alpha Academy',
      city: 'New Delhi',
      plan: 'STANDARD',
      admin: { email: 'admin@alpha.test', name: 'Alpha Admin', password: PASSWORD },
    });
    expect(a.status, a.text).toBe(201);
    expect(a.body.data.studentCap).toBe(2000); // §16 cap derived from the plan
    expect(a.body.data.admin.role).toBe('SCHOOL_ADMIN');
    expect(a.body.data.adminMustResetPassword).toBe(false);

    const b = await owner.post('/api/v1/super-admin/schools').send({
      schoolCode: 'API-B',
      name: 'Beta Institute',
      plan: 'BASIC',
      admin: { email: 'admin@beta.test', name: 'Beta Admin', password: PASSWORD },
    });
    expect(b.status).toBe(201);

    // Prisma P2002 must surface as a conflict, not a 500.
    const dupe = await owner.post('/api/v1/super-admin/schools').send({
      schoolCode: 'API-A',
      name: 'Duplicate',
      admin: { email: 'other@alpha.test', name: 'Other', password: PASSWORD },
    });
    expect(dupe.status).toBe(409);
  });

  it('provisions a school whose admin can immediately sign in', async () => {
    // The whole point of §3: the flow completes through the API, with no seed
    // script standing between "school created" and "someone can use it".
    const owner = await signIn('', OWNER_EMAIL);

    const created = await owner.post('/api/v1/super-admin/schools').send({
      schoolCode: 'API-C',
      name: 'Gamma College',
      admin: { email: 'head@gamma.test', name: 'Gamma Head', password: PASSWORD },
    });
    expect(created.status, created.text).toBe(201);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'API-C', email: 'head@gamma.test', password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('SCHOOL_ADMIN');
  });

  it('leaves no school behind when the admin cannot be created', async () => {
    const owner = await signIn('', OWNER_EMAIL);

    // Same address as API-C's admin — but email is unique per school, so this
    // has to fail for a different reason: an invalid password.
    const res = await owner.post('/api/v1/super-admin/schools').send({
      schoolCode: 'API-ORPHAN',
      name: 'Should Not Exist',
      admin: { email: 'head@orphan.test', name: 'Nobody', password: 'weak' },
    });
    expect(res.status).toBe(422);

    // The transaction is what makes this true: a half-provisioned school with
    // nobody able to log in is exactly the dead end this endpoint removes.
    const orphan = await asSuperAdmin((tx) =>
      tx.school.findUnique({ where: { schoolCode: 'API-ORPHAN' } })
    );
    expect(orphan).toBeNull();
  });

  it('creates the admin without a usable password when none is supplied', async () => {
    const owner = await signIn('', OWNER_EMAIL);

    const created = await owner.post('/api/v1/super-admin/schools').send({
      schoolCode: 'API-D',
      name: 'Delta School',
      admin: { email: 'head@delta.test', name: 'Delta Head' },
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body.data.adminMustResetPassword).toBe(true);

    // The platform owner never handled a credential, so there is nothing to
    // guess: the account exists and cannot be signed into until a reset.
    const attempt = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'API-D', email: 'head@delta.test', password: PASSWORD });
    expect(attempt.status).toBe(401);
  });

  it('rejects a malformed school code with 422', async () => {
    const owner = await signIn('', OWNER_EMAIL);
    const res = await owner.post('/api/v1/super-admin/schools').send({
      schoolCode: 'bad code!',
      name: 'Nope',
      admin: { email: 'a@b.test', name: 'A B', password: PASSWORD },
    });
    expect(res.status).toBe(422);
  });

  it('refuses to create a school with no admin at all', async () => {
    const owner = await signIn('', OWNER_EMAIL);
    const res = await owner
      .post('/api/v1/super-admin/schools')
      .send({ schoolCode: 'API-NOADMIN', name: 'No Admin' });

    // Optional would leave the old dead end reachable.
    expect(res.status).toBe(422);
  });
});

describe('school-scoped identity', () => {
  // No seeding here any more: API-A and API-B were provisioned with their
  // admins above, through the API, which is the point of that endpoint.

  it('treats the same email at two schools as two people', async () => {
    const adminA = await signIn('API-A', 'admin@alpha.test');
    const adminB = await signIn('API-B', 'admin@beta.test');

    const a = await adminA
      .post('/api/v1/school-admin/users')
      .send({ email: SHARED_STUDENT, password: PASSWORD, name: 'Alpha Student', role: 'STUDENT' });
    expect(a.status).toBe(201);

    const b = await adminB
      .post('/api/v1/school-admin/users')
      .send({ email: SHARED_STUDENT, password: PASSWORD, name: 'Beta Student', role: 'STUDENT' });
    expect(b.status).toBe(201);

    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'API-A', email: SHARED_STUDENT, password: PASSWORD });
    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'API-B', email: SHARED_STUDENT, password: PASSWORD });

    expect(loginA.body.data.user.name).toBe('Alpha Student');
    expect(loginB.body.data.user.name).toBe('Beta Student');
    expect(loginA.body.data.user.id).not.toBe(loginB.body.data.user.id);
  });

  it('does not let one school see another\'s users', async () => {
    const adminA = await signIn('API-A', 'admin@alpha.test');
    const res = await adminA.get('/api/v1/school-admin/users');

    expect(res.status).toBe(200);
    const names = res.body.data.map((u: { name: string }) => u.name);
    expect(names).toContain('Alpha Student');
    expect(names).not.toContain('Beta Student');
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'API-A', email: SHARED_STUDENT, password: 'Wrong!12345' });
    const noSuchUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'API-A', email: 'ghost@api.test', password: 'Wrong!12345' });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(noSuchUser.body.message).toBe(wrongPassword.body.message);
  });

  it('rejects a valid password against the wrong school', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'API-B', email: 'admin@alpha.test', password: PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe('authorization', () => {
  it('refuses anonymous requests', async () => {
    expect((await request(app).get('/api/v1/school-admin/users')).status).toBe(401);
    expect((await request(app).get('/api/v1/super-admin/schools')).status).toBe(401);
  });

  it('keeps a school admin out of super-admin routes', async () => {
    const adminA = await signIn('API-A', 'admin@alpha.test');
    expect((await adminA.get('/api/v1/super-admin/schools')).status).toBe(403);
  });

  it('keeps the platform owner out of tenant-scoped routes', async () => {
    // SUPER_ADMIN has no school, so a tenant-scoped route is meaningless
    // for them; requireTenant rejects rather than silently returning nothing.
    const owner = await signIn('', OWNER_EMAIL);
    expect((await owner.get('/api/v1/school-admin/users')).status).toBe(403);
  });

  it('will not let a school admin mint a super admin', async () => {
    const adminA = await signIn('API-A', 'admin@alpha.test');
    const res = await adminA
      .post('/api/v1/school-admin/users')
      .send({ email: 'sneaky@api.test', password: PASSWORD, name: 'Sneaky', role: 'SUPER_ADMIN' });

    expect(res.status).toBe(422);
  });

  it('ignores a school_id supplied in the request body', async () => {
    const adminA = await signIn('API-A', 'admin@alpha.test');
    const beta = await asSuperAdmin((tx) =>
      tx.school.findUniqueOrThrow({ where: { schoolCode: 'API-B' } })
    );

    // The schema is .strict(), so an unexpected key is a validation error
    // rather than being silently dropped.
    const res = await adminA.post('/api/v1/school-admin/users').send({
      email: 'crosstenant@api.test',
      password: PASSWORD,
      name: 'Cross Tenant',
      role: 'STUDENT',
      schoolId: beta.id,
    });

    expect(res.status).toBe(422);
  });
});

describe('session lifecycle', () => {
  it('returns the caller profile with school branding', async () => {
    const adminA = await signIn('API-A', 'admin@alpha.test');
    const res = await adminA.get('/api/v1/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('admin@alpha.test');
    expect(res.body.data.school.schoolCode).toBe('API-A');
  });

  it('refreshes and then invalidates on logout', async () => {
    const adminA = await signIn('API-A', 'admin@alpha.test');

    expect((await adminA.post('/api/v1/auth/refresh')).status).toBe(200);
    expect((await adminA.get('/api/v1/auth/me')).status).toBe(200);
    expect((await adminA.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await adminA.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('invalidates live sessions when tokenVersion is bumped', async () => {
    const adminA = await signIn('API-A', 'admin@alpha.test');
    expect((await adminA.get('/api/v1/auth/me')).status).toBe(200);

    await asSuperAdmin((tx) =>
      tx.user.updateMany({
        where: { email: 'admin@alpha.test' },
        data: { tokenVersion: { increment: 1 } },
      })
    );

    // The access token is still cryptographically valid, so /me keeps working
    // until it expires — revocation takes effect at the refresh boundary.
    expect((await adminA.post('/api/v1/auth/refresh')).status).toBe(401);
  });

  it('locks an account after three failed attempts', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    await asSuperAdmin(async (tx) => {
      const school = await tx.school.findUniqueOrThrow({ where: { schoolCode: 'API-B' } });
      await tx.user.create({
        data: {
          schoolId: school.id,
          email: 'lockme@api.test',
          passwordHash,
          name: 'Lock Me',
          role: 'STUDENT',
        },
      });
    });

    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ schoolCode: 'API-B', email: 'lockme@api.test', password: 'Wrong!12345' });
      expect(res.status).toBe(401);
    }

    const third = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'API-B', email: 'lockme@api.test', password: 'Wrong!12345' });
    expect(third.status).toBe(423);

    // Locked out even with the correct password.
    const correct = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: 'API-B', email: 'lockme@api.test', password: PASSWORD });
    expect(correct.status).toBe(423);
  });
});

describe('transport', () => {
  it('returns JSON 404s rather than HTML', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('sets security headers on every route, liveness included', async () => {
    for (const path of ['/health', '/', '/api/v1']) {
      const res = await request(app).get(path);
      expect(res.headers['content-security-policy'], `missing CSP on ${path}`).toBeDefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
  });
});
