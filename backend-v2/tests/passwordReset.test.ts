import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';
import { getOutbox, clearOutbox } from '../src/services/email.service';
import { REFRESH_COOKIE } from '../src/middlewares/auth';

/**
 * Password reset over HTTP.
 *
 * Two properties carry the weight here. The request endpoint must answer
 * identically for a real address and an invented one — otherwise it enumerates
 * a school's roster, which in this product is a list of children. And the link
 * must work exactly once.
 *
 * No SMTP host is configured under NODE_ENV=test, so email.service captures
 * messages in an in-process outbox instead of sending them. That is also what
 * lets these tests read the token out of the email the way a user would.
 */

const PASSWORD = 'Passw0rd!x';
const NEW_PASSWORD = 'N3wPassw0rd!';
const EMAIL = 'reset@api.test';
const SCHOOL = 'RST-1';

let userId: string;

const forgot = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/auth/password/forgot').send(body);

const login = (password: string) =>
  request(app)
    .post('/api/v1/auth/login')
    .send({ schoolCode: SCHOOL, email: EMAIL, password });

/** Pulls the reset token out of the most recent captured email. */
const tokenFromEmail = (): string | null => {
  const outbox = getOutbox();
  const last = outbox[outbox.length - 1];
  if (!last) return null;
  return new URL(last.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token');
};

/** Runs the request step and returns the emailed token. */
const requestLink = async (): Promise<string> => {
  clearOutbox();
  await forgot({ schoolCode: SCHOOL, email: EMAIL }).expect(200);
  const token = tokenFromEmail();
  expect(token).toBeTruthy();
  return token!;
};

/** Restores the known password so each test starts from the same place. */
const restorePassword = async () => {
  await prisma.$executeRaw`SELECT app_reset_password(${userId}::uuid, ${await hashPassword(PASSWORD)})`;
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await asSuperAdmin(async (tx) => {
    const school = await tx.school.create({ data: { schoolCode: SCHOOL, name: 'Reset School' } });
    const user = await tx.user.create({
      data: { schoolId: school.id, email: EMAIL, passwordHash, name: 'Reset User', role: 'STUDENT' },
    });
    userId = user.id;
  });
});

beforeEach(async () => {
  clearOutbox();
  await restorePassword();
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await asSuperAdmin((tx) => tx.school.deleteMany({ where: { schoolCode: SCHOOL } }));
  await prisma.$disconnect();
});

describe('requesting a link', () => {
  it('emails a single-use link to a real account', async () => {
    clearOutbox();
    const res = await forgot({ schoolCode: SCHOOL, email: EMAIL }).expect(200);

    expect(res.body.message).toMatch(/if that account exists/i);
    expect(getOutbox()).toHaveLength(1);
    expect(getOutbox()[0]!.to).toBe(EMAIL);
    expect(getOutbox()[0]!.subject).toMatch(/reset your edusphere password/i);
    expect(tokenFromEmail()).toBeTruthy();
  });

  it('answers identically for an address that does not exist', async () => {
    clearOutbox();
    const real = await forgot({ schoolCode: SCHOOL, email: EMAIL });
    const sentForReal = getOutbox().length;

    clearOutbox();
    const fake = await forgot({ schoolCode: SCHOOL, email: 'nobody@api.test' });

    // The response is the enumeration surface, so it is what must match.
    expect(fake.status).toBe(real.status);
    expect(fake.body).toEqual(real.body);

    // And no mail went anywhere, which is the part the caller cannot observe.
    expect(sentForReal).toBe(1);
    expect(getOutbox()).toHaveLength(0);
  });

  it('answers identically for the right email at the wrong school', async () => {
    const res = await forgot({ schoolCode: 'NOPE-9', email: EMAIL }).expect(200);
    expect(res.body.message).toMatch(/if that account exists/i);
    expect(getOutbox()).toHaveLength(0);
  });

  it('invalidates an outstanding link when a new one is requested', async () => {
    const first = await requestLink();
    const second = await requestLink();

    expect(second).not.toBe(first);

    // The stale link is dead: otherwise an old email keeps working after the
    // user has already reset.
    await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token: first, password: NEW_PASSWORD })
      .expect(400);

    await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token: second, password: NEW_PASSWORD })
      .expect(200);
  });

  it('rejects a malformed request rather than treating it as anonymous', async () => {
    await forgot({ email: 'not-an-email' }).expect(422);
  });
});

describe('completing a reset', () => {
  it('changes the password and notifies the account', async () => {
    const token = await requestLink();

    const res = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);

    expect(res.body.message).toMatch(/sign in again/i);

    await login(PASSWORD).expect(401);
    await login(NEW_PASSWORD).expect(200);

    const notice = getOutbox().at(-1)!;
    expect(notice.subject).toMatch(/password was changed/i);
    expect(notice.to).toBe(EMAIL);
  });

  it('refuses to reuse the link', async () => {
    const token = await requestLink();

    await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'An0therPass!' })
      .expect(400);

    // The second attempt changed nothing.
    await login(NEW_PASSWORD).expect(200);
  });

  it('refuses an unknown or expired token, with the same message either way', async () => {
    const unknown = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token: 'not-a-real-token', password: NEW_PASSWORD })
      .expect(400);

    const token = await requestLink();
    await prisma.passwordResetToken.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(400);

    // Telling the two apart would confirm to whoever holds a stolen link that
    // it was genuine.
    expect(expired.body.message).toBe(unknown.body.message);
  });

  it('holds the new password to the same policy', async () => {
    const token = await requestLink();

    await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'short' })
      .expect(422);

    // Rejected before the token was spent, so the user can try again.
    await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);
  });

  it('signs every existing session out', async () => {
    const session = await login(PASSWORD).expect(200);
    const refreshCookie = (session.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!
      .split(';')[0]!;

    // The session works before the reset.
    await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(200);

    const token = await requestLink();
    await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);

    // A reset is what someone does when they believe an account is compromised.
    // If the attacker's session survives it, the reset achieved nothing.
    await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie).expect(401);
  });

  it('clears the lockout, so a locked-out user can sign straight back in', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await login('WrongPass!1');
    }
    await login(PASSWORD).expect(423); // locked

    const token = await requestLink();
    await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);

    // Without clearing lock_until the reset would appear not to have worked.
    await login(NEW_PASSWORD).expect(200);
  });
});
