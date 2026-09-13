import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/middlewares/auth';
import { codeForStep, stepFor } from '../src/utils/totp';
import { decryptSecret } from '../src/utils/crypto';

/**
 * Two-factor authentication, end to end over HTTP.
 *
 * The property that matters: once 2FA is on, a correct password is not enough.
 * Everything else here exists to stop that guarantee eroding — replayed codes,
 * spent recovery codes, and challenge tokens outliving their purpose.
 */

const PASSWORD = 'Passw0rd!x';
const EMAIL = 'mfa@api.test';
const SCHOOL = 'MFA-1';

const login = (password = PASSWORD) =>
  request(app).post('/api/v1/auth/login').send({ schoolCode: SCHOOL, email: EMAIL, password });

const cookiesFrom = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
};

const cookieNames = (res: request.Response) => cookiesFrom(res).map((c) => c.split('=')[0]);

const sessionCookies = (res: request.Response) =>
  cookiesFrom(res)
    .map((c) => c.split(';')[0]!)
    .join('; ');

let userId: string;

/**
 * One step ahead of now. Still inside the drift window, so the server accepts
 * it, but above the watermark left by whatever code was last spent.
 */
const NEXT_STEP = 1;

/** Reads the stored secret the way the server would, to mint valid codes. */
const currentCode = async (offset = 0): Promise<string> => {
  const rows = await prisma.$queryRaw<{ secret: string | null }[]>`
    SELECT secret FROM app_2fa_lookup(${userId}::uuid)`;
  return codeForStep(decryptSecret(rows[0]!.secret!), stepFor() + offset);
};

/** Signs in and completes enrollment, returning the recovery codes. */
const enroll = async (): Promise<{ session: string; recoveryCodes: string[] }> => {
  const session = sessionCookies(await login());

  await request(app).post('/api/v1/auth/2fa/setup').set('Cookie', session).expect(200);

  const enabled = await request(app)
    .post('/api/v1/auth/2fa/enable')
    .set('Cookie', session)
    .send({ code: await currentCode() })
    .expect(200);

  return { session, recoveryCodes: enabled.body.data.recoveryCodes };
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await asSuperAdmin(async (tx) => {
    const school = await tx.school.create({ data: { schoolCode: SCHOOL, name: 'MFA School' } });
    const user = await tx.user.create({
      data: { schoolId: school.id, email: EMAIL, passwordHash, name: 'Mfa User', role: 'TEACHER' },
    });
    userId = user.id;
  });
});

/**
 * Every test starts with 2FA off.
 *
 * Without this the suite is order-dependent in the worst way: the moment one
 * test enables 2FA, `login()` in the next returns a challenge instead of
 * cookies, and the helpers that assume a session all fail for a reason that has
 * nothing to do with what they are testing.
 */
beforeEach(async () => {
  await prisma.$executeRaw`SELECT app_2fa_disable(${userId}::uuid)`;
  await prisma.recoveryCode.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await asSuperAdmin((tx) => tx.school.deleteMany({ where: { schoolCode: SCHOOL } }));
  await prisma.$disconnect();
});

describe('enrollment', () => {
  it('does not gate login until setup is confirmed with a working code', async () => {
    const session = sessionCookies(await login());

    const setup = await request(app)
      .post('/api/v1/auth/2fa/setup')
      .set('Cookie', session)
      .expect(200);

    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.data.secret).toMatch(/^[A-Z2-7]+$/);

    // A secret exists but is not enabled, so login must still issue a session.
    const stillDirect = await login();
    expect(stillDirect.body.data.twoFactorRequired).toBe(false);
    expect(cookieNames(stillDirect)).toContain(ACCESS_COOKIE);

    const status = await request(app).get('/api/v1/auth/2fa').set('Cookie', session).expect(200);
    expect(status.body.data).toMatchObject({ enabled: false, pendingSetup: true });
  });

  it('rejects a wrong confirmation code and stays disabled', async () => {
    const session = sessionCookies(await login());
    await request(app).post('/api/v1/auth/2fa/setup').set('Cookie', session).expect(200);

    await request(app)
      .post('/api/v1/auth/2fa/enable')
      .set('Cookie', session)
      .send({ code: '000000' })
      .expect(400);

    const status = await request(app).get('/api/v1/auth/2fa').set('Cookie', session);
    expect(status.body.data.enabled).toBe(false);
  });

  it('enables on a valid code and issues ten recovery codes', async () => {
    const { session, recoveryCodes } = await enroll();

    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    recoveryCodes.forEach((code) => expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/));

    const status = await request(app).get('/api/v1/auth/2fa').set('Cookie', session);
    expect(status.body.data).toMatchObject({ enabled: true, remainingRecoveryCodes: 10 });
  });

  it('stores the secret encrypted, never in the clear', async () => {
    await enroll();

    const [row] = await prisma.$queryRaw<{ secret: string }[]>`
      SELECT secret FROM app_2fa_lookup(${userId}::uuid)`;

    expect(row!.secret).toMatch(/^v1\./);
    // Decryptable by the server, unreadable as stored.
    expect(decryptSecret(row!.secret)).toMatch(/^[A-Z2-7]+$/);
    expect(row!.secret).not.toContain(decryptSecret(row!.secret));
  });
});

describe('login with a second factor', () => {
  it('withholds session cookies until the code is supplied', async () => {
    await enroll();

    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.data.twoFactorRequired).toBe(true);
    expect(res.body.data.challengeToken).toBeTruthy();

    // The critical assertion: a correct password alone sets nothing.
    expect(cookieNames(res)).not.toContain(ACCESS_COOKIE);
    expect(cookieNames(res)).not.toContain(REFRESH_COOKIE);
  });

  it('completes the login when the code is correct', async () => {
    await enroll();
    const { challengeToken } = (await login()).body.data;

    // NEXT_STEP, not the current one: confirming enrollment consumed the code
    // it was confirmed with. See "consumes the code used to confirm setup".
    const verified = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, code: await currentCode(NEXT_STEP) })
      .expect(200);

    expect(cookieNames(verified)).toEqual(
      expect.arrayContaining([ACCESS_COOKIE, REFRESH_COOKIE])
    );

    // And the session actually works.
    await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', sessionCookies(verified))
      .expect(200);
  });

  it('rejects a wrong code without issuing anything', async () => {
    await enroll();
    const { challengeToken } = (await login()).body.data;

    const res = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, code: '000000' })
      .expect(401);

    expect(cookieNames(res)).not.toContain(ACCESS_COOKIE);
  });

  it('refuses a fabricated challenge token', async () => {
    await enroll();

    await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: 'not.a.token', code: await currentCode() })
      .expect(401);
  });

  it('consumes the code used to confirm setup', async () => {
    // Enrollment is a successful verification like any other, so the code that
    // completed it is spent. A user enrolling and then signing in on a second
    // device inside the same 30 seconds has to wait for the next code.
    await enroll();
    const { challengeToken } = (await login()).body.data;

    await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, code: await currentCode() })
      .expect(401);
  });

  it('will not accept the same code twice', async () => {
    await enroll();
    const code = await currentCode(NEXT_STEP);

    const first = (await login()).body.data.challengeToken;
    await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: first, code })
      .expect(200);

    // Same code, fresh challenge — a captured code must be worthless even
    // inside its own validity window.
    const second = (await login()).body.data.challengeToken;
    await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: second, code })
      .expect(401);
  });

  it('will not accept an earlier code once a later one is spent', async () => {
    await enroll();
    const earlier = await currentCode();

    const first = (await login()).body.data.challengeToken;
    await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: first, code: await currentCode(NEXT_STEP) })
      .expect(200);

    // Still inside the drift window, so only the watermark stops it.
    const second = (await login()).body.data.challengeToken;
    await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: second, code: earlier })
      .expect(401);
  });
});

describe('recovery codes', () => {
  it('let a user in when the authenticator is gone, once each', async () => {
    const { recoveryCodes } = await enroll();
    const code = recoveryCodes[0]!;

    const first = (await login()).body.data.challengeToken;
    const used = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: first, code })
      .expect(200);

    expect(used.body.data.usedRecoveryCode).toBe(true);
    expect(used.body.data.remainingRecoveryCodes).toBe(9);
    expect(cookieNames(used)).toContain(ACCESS_COOKIE);

    const second = (await login()).body.data.challengeToken;
    await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken: second, code })
      .expect(401);
  });

  it('accepts them however the user retypes them', async () => {
    const { recoveryCodes } = await enroll();
    const messy = recoveryCodes[0]!.toLowerCase().replace('-', ' ');

    const challengeToken = (await login()).body.data.challengeToken;
    await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, code: messy })
      .expect(200);
  });

  it('invalidates the old set when regenerated', async () => {
    const { session, recoveryCodes } = await enroll();

    const reissued = await request(app)
      .post('/api/v1/auth/2fa/recovery-codes')
      .set('Cookie', session)
      .send({ password: PASSWORD })
      .expect(200);

    const fresh: string[] = reissued.body.data.recoveryCodes;
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(recoveryCodes[0]);

    const challengeToken = (await login()).body.data.challengeToken;
    await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ challengeToken, code: recoveryCodes[0]! })
      .expect(401);
  });

  it('needs the password to reissue', async () => {
    const { session } = await enroll();

    await request(app)
      .post('/api/v1/auth/2fa/recovery-codes')
      .set('Cookie', session)
      .send({ password: 'not-the-password' })
      .expect(401);
  });
});

describe('disabling', () => {
  it('needs the password, then restores single-factor login', async () => {
    const { session } = await enroll();

    await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Cookie', session)
      .send({ password: 'wrong' })
      .expect(401);

    await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Cookie', session)
      .send({ password: PASSWORD })
      .expect(200);

    const res = await login();
    expect(res.body.data.twoFactorRequired).toBe(false);
    expect(cookieNames(res)).toContain(ACCESS_COOKIE);
  });

  it('revokes existing sessions, so a stolen one does not survive the downgrade', async () => {
    const { session } = await enroll();
    const separate = sessionCookies(
      await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({
          challengeToken: (await login()).body.data.challengeToken,
          code: await currentCode(),
        })
    );

    await request(app)
      .post('/api/v1/auth/2fa/disable')
      .set('Cookie', session)
      .send({ password: PASSWORD })
      .expect(200);

    await request(app).post('/api/v1/auth/refresh').set('Cookie', separate).expect(401);
  });

  it('requires authentication for every management route', async () => {
    for (const path of ['/2fa', '/2fa/setup', '/2fa/enable', '/2fa/disable', '/2fa/recovery-codes']) {
      const res = await (path === '/2fa'
        ? request(app).get(`/api/v1/auth${path}`)
        : request(app).post(`/api/v1/auth${path}`).send({ password: PASSWORD, code: '123456' }));
      expect(res.status).toBe(401);
    }
  });
});
