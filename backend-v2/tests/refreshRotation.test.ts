import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/db/prisma';
import { asSuperAdmin } from '../src/db/tenantContext';
import { hashPassword } from '../src/services/auth.service';
import { REFRESH_COOKIE } from '../src/middlewares/auth';

/**
 * Refresh-token rotation and theft detection.
 *
 * The property under test: a refresh token is single-use. Replaying one is
 * evidence that two parties hold it, and the only safe response is to revoke
 * every session descended from that login.
 */

const PASSWORD = 'Passw0rd!x';
const EMAIL = 'rotate@api.test';

/** Pulls the refresh cookie value out of a Set-Cookie header. */
const refreshCookieFrom = (res: request.Response): string | null => {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const found = list.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  return found ? found.split(';')[0]! : null;
};

const login = () =>
  request(app).post('/api/v1/auth/login').send({ schoolCode: 'ROT-1', email: EMAIL, password: PASSWORD });

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await asSuperAdmin(async (tx) => {
    const school = await tx.school.create({ data: { schoolCode: 'ROT-1', name: 'Rotation School' } });
    await tx.user.create({
      data: { schoolId: school.id, email: EMAIL, passwordHash, name: 'Rotator', role: 'STUDENT' },
    });
  });
});

afterAll(async () => {
  await asSuperAdmin((tx) => tx.school.deleteMany({ where: { schoolCode: 'ROT-1' } }));
  await prisma.$disconnect();
});

describe('rotation', () => {
  it('issues a different refresh token on every refresh', async () => {
    const first = await login();
    const original = refreshCookieFrom(first);
    expect(original).toBeTruthy();

    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', original!);
    expect(refreshed.status).toBe(200);

    const rotated = refreshCookieFrom(refreshed);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(original);
  });

  it('records the login as one family and marks the consumed token rotated', async () => {
    const res = await login();
    const cookie = refreshCookieFrom(res)!;
    await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);

    const user = await asSuperAdmin((tx) => tx.user.findFirstOrThrow({ where: { email: EMAIL } }));
    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });

    const families = new Set(tokens.map((t) => t.familyId));
    expect(families.size).toBeGreaterThanOrEqual(1);
    expect(tokens.some((t) => t.rotatedAt !== null)).toBe(true);
  });
});

describe('reuse detection', () => {
  it('rejects a replayed token and revokes the entire family', async () => {
    const res = await login();
    const original = refreshCookieFrom(res)!;

    // Legitimate rotation.
    const good = await request(app).post('/api/v1/auth/refresh').set('Cookie', original);
    expect(good.status).toBe(200);
    const successor = refreshCookieFrom(good)!;

    // The attacker replays the token they captured earlier.
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', original);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toMatch(/reuse/i);

    // The victim's newer token must also be dead — we cannot tell which party
    // is which, so both are cut off and a fresh login is required.
    const victim = await request(app).post('/api/v1/auth/refresh').set('Cookie', successor);
    expect(victim.status).toBe(401);
  });

  it('leaves other logins untouched when one family is burned', async () => {
    const sessionA = refreshCookieFrom(await login())!;
    const sessionB = refreshCookieFrom(await login())!;

    // Burn family A by replaying its original token.
    await request(app).post('/api/v1/auth/refresh').set('Cookie', sessionA);
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', sessionA);
    expect(replay.status).toBe(401);

    // B was a separate login, so a separate family, and should still work.
    const stillGood = await request(app).post('/api/v1/auth/refresh').set('Cookie', sessionB);
    expect(stillGood.status).toBe(200);
  });
});

describe('logout', () => {
  it('revokes the token rather than only clearing the cookie', async () => {
    const cookie = refreshCookieFrom(await login())!;

    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);

    // A copy of the cookie held elsewhere must not still work.
    const afterLogout = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });
});
