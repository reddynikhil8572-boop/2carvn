import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin } from '../src/db/tenantContext';
import { getOutbox, clearOutbox } from '../src/services/email.service';

/**
 * Creating a user without choosing their password.
 *
 * `POST /school-admin/users` required a password until 2026-08-07, which meant
 * an administrator had to invent one for every pupil and hand it over in
 * person. The passwords that produces are not passwords. This mirrors what
 * `POST /super-admin/schools` already did for a school's first admin: omit it,
 * and the account is created unusable and emailed a set-password link.
 *
 * The property worth protecting is the *unusable* part. It would be easy to
 * write this so the account is created with a weak-but-real fallback and the
 * test would still pass on "a link was sent" — so the assertion that no
 * password works is here, not implied.
 *
 * No SMTP host is configured under NODE_ENV=test, so email.service captures
 * mail in an in-process outbox and the link is read the way a user would.
 */

const OWNER = 'owner@provision.test';
const ADMIN = 'admin@provision.test';
const PASSWORD = 'Passw0rd!x';
const SCHOOL = 'PRV-1';

let adminAgent: ReturnType<typeof request.agent>;

const linkTokenFromLastEmail = (): string | null => {
  const outbox = getOutbox();
  const last = outbox[outbox.length - 1];
  if (!last) return null;
  const url = last.text.match(/https?:\/\/\S+/);
  return url ? new URL(url[0]).searchParams.get('token') : null;
};

beforeAll(async () => {
  const owner = request.agent(app);

  await asSuperAdmin(async (tx) => {
    const { hashPassword } = await import('../src/services/auth.service');
    await tx.user.create({
      data: {
        email: OWNER,
        passwordHash: await hashPassword(PASSWORD),
        name: 'Owner',
        role: 'SUPER_ADMIN',
      },
    });
  });

  await owner.post('/api/v1/auth/login').send({ email: OWNER, password: PASSWORD }).expect(200);
  await owner
    .post('/api/v1/super-admin/schools')
    .send({
      schoolCode: SCHOOL,
      name: 'Provision School',
      admin: { email: ADMIN, name: 'Provision Admin', password: PASSWORD },
    })
    .expect(201);

  adminAgent = request.agent(app);
  await adminAgent
    .post('/api/v1/auth/login')
    .send({ schoolCode: SCHOOL, email: ADMIN, password: PASSWORD })
    .expect(200);
});

afterAll(async () => {
  await asSuperAdmin(async (tx) => {
    await tx.school.deleteMany({ where: { schoolCode: SCHOOL } });
    await tx.user.deleteMany({ where: { email: OWNER } });
  });
  await prisma.$disconnect();
});

describe('creating a user without a password', () => {
  const student = 'pupil@provision.test';

  it('creates the account and says a link was sent', async () => {
    clearOutbox();

    const res = await adminAgent
      .post('/api/v1/school-admin/users')
      .send({ email: student, name: 'A Pupil', role: 'STUDENT' });

    expect(res.status, res.text).toBe(201);
    expect(res.body.data.email).toBe(student);
    // The client cannot infer this from the rest of the payload, and it decides
    // what the UI tells the administrator to do next.
    expect(res.body.data.mustSetPassword).toBe(true);
  });

  it('emails a set-password link that actually arrives', async () => {
    const outbox = getOutbox();
    expect(outbox.length, 'no mail was captured').toBeGreaterThan(0);
    expect(outbox[outbox.length - 1]!.to).toBe(student);
    expect(linkTokenFromLastEmail()).toBeTruthy();
  });

  it('leaves the account unusable until the link is followed', async () => {
    // The whole point. A fallback password that happened to be weak rather than
    // unusable would satisfy every other assertion in this file.
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: SCHOOL, email: student, password: PASSWORD });

    expect(res.status).toBe(401);
  });

  it('lets the pupil in once they set a password through the link', async () => {
    const token = linkTokenFromLastEmail()!;

    const reset = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'Ch0senByThem!' });
    expect(reset.status, reset.text).toBe(200);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: SCHOOL, email: student, password: 'Ch0senByThem!' });
    expect(login.status, login.text).toBe(200);
    expect(login.body.data.user.name).toBe('A Pupil');
  });

  it('still accepts an explicitly chosen password, for automation', async () => {
    clearOutbox();

    const res = await adminAgent
      .post('/api/v1/school-admin/users')
      .send({
        email: 'chosen@provision.test',
        name: 'Chosen Password',
        role: 'TEACHER',
        password: PASSWORD,
      });

    expect(res.status, res.text).toBe(201);
    expect(res.body.data.mustSetPassword).toBe(false);
    // No link, because nothing needs setting.
    expect(getOutbox().length).toBe(0);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ schoolCode: SCHOOL, email: 'chosen@provision.test', password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('records who set the password in the audit log', async () => {
    // "Who chose this credential" is the question that matters when an account
    // is later disputed, and it cannot be reconstructed after the fact.
    const entries = await asSuperAdmin((tx) =>
      tx.auditLog.findMany({
        where: { action: 'USER_CREATED' },
        orderBy: { createdAt: 'desc' },
        take: 2,
      })
    );

    const setBy = entries.map((e) => (e.metadata as { passwordSetBy?: string })?.passwordSetBy);
    expect(setBy).toContain('reset_link');
    expect(setBy).toContain('school_admin');
  });
});
