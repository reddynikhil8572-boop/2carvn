import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db/prisma';
import { withTenant, asSuperAdmin, withoutTenant } from '../src/db/tenantContext';

/**
 * Tenant isolation, asserted against the database rather than the application.
 *
 * These tests are the guard against a specific, silent failure: if the app
 * ever connects as a Postgres superuser, every RLS policy is bypassed with no
 * error anywhere, and cross-tenant reads start succeeding. That happened once
 * during Phase 1 — the schema, the policies and the application code were all
 * correct, and isolation was still completely absent.
 */

let schoolA: { id: string };
let schoolB: { id: string };
let studentA: { id: string };
let studentB: { id: string };

const SHARED_EMAIL = 'shared@rls.test';

beforeAll(async () => {
  const seeded = await asSuperAdmin(async (tx) => {
    const a = await tx.school.create({ data: { schoolCode: 'RLS-A', name: 'School A' } });
    const b = await tx.school.create({ data: { schoolCode: 'RLS-B', name: 'School B' } });

    const sa = await tx.user.create({
      data: { schoolId: a.id, email: SHARED_EMAIL, passwordHash: 'x', name: 'Student A', role: 'STUDENT' },
    });
    const sb = await tx.user.create({
      data: { schoolId: b.id, email: SHARED_EMAIL, passwordHash: 'x', name: 'Student B', role: 'STUDENT' },
    });

    return { a, b, sa, sb };
  });

  schoolA = seeded.a;
  schoolB = seeded.b;
  studentA = seeded.sa;
  studentB = seeded.sb;
});

afterAll(async () => {
  await asSuperAdmin((tx) =>
    tx.school.deleteMany({ where: { schoolCode: { in: ['RLS-A', 'RLS-B'] } } })
  );
  await prisma.$disconnect();
});

describe('the connecting role', () => {
  it('is not a superuser, or every policy below is vacuous', async () => {
    const [{ is_superuser: isSuperuser, current_user: role }] = await prisma.$queryRaw<
      { is_superuser: boolean; current_user: string }[]
    >`SELECT rolsuper AS is_superuser, current_user FROM pg_roles WHERE rolname = current_user`;

    expect(isSuperuser, `connected as "${role}", which bypasses RLS entirely`).toBe(false);
  });

  it('cannot bypass RLS', async () => {
    const [{ rolbypassrls }] = await prisma.$queryRaw<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    expect(rolbypassrls).toBe(false);
  });
});

describe('reads', () => {
  it('scopes rows to the current tenant', async () => {
    const a = await withTenant(schoolA.id, (tx) => tx.user.findMany());
    const b = await withTenant(schoolB.id, (tx) => tx.user.findMany());

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.name).toBe('Student A');
    expect(b[0]!.name).toBe('Student B');
  });

  it('hides another tenant even when the primary key is known', async () => {
    const leaked = await withTenant(schoolA.id, (tx) =>
      tx.user.findUnique({ where: { id: studentB.id } })
    );
    expect(leaked).toBeNull();
  });

  it('hides another tenant\'s school row', async () => {
    const leaked = await withTenant(schoolA.id, (tx) =>
      tx.school.findUnique({ where: { id: schoolB.id } })
    );
    expect(leaked).toBeNull();
  });

  it('returns nothing at all when no tenant is set — fails closed, not open', async () => {
    const users = await withoutTenant((tx) => tx.user.findMany());
    const schools = await withoutTenant((tx) => tx.school.findMany());

    expect(users).toHaveLength(0);
    expect(schools).toHaveLength(0);
  });
});

describe('writes', () => {
  it('rejects an insert aimed at another tenant', async () => {
    await expect(
      withTenant(schoolA.id, (tx) =>
        tx.user.create({
          data: {
            schoolId: schoolB.id,
            email: 'intruder@rls.test',
            passwordHash: 'x',
            name: 'Intruder',
            role: 'STUDENT',
          },
        })
      )
    ).rejects.toThrow();
  });

  it('updates nothing when targeting another tenant', async () => {
    const result = await withTenant(schoolA.id, (tx) =>
      tx.user.updateMany({ where: { id: studentB.id }, data: { name: 'TAMPERED' } })
    );
    expect(result.count).toBe(0);

    const untouched = await withTenant(schoolB.id, (tx) =>
      tx.user.findUnique({ where: { id: studentB.id } })
    );
    expect(untouched?.name).toBe('Student B');
  });
});

describe('identity', () => {
  it('allows the same email at different schools as distinct people', async () => {
    expect(studentA.id).not.toBe(studentB.id);

    const a = await withTenant(schoolA.id, (tx) =>
      tx.user.findFirst({ where: { email: SHARED_EMAIL } })
    );
    const b = await withTenant(schoolB.id, (tx) =>
      tx.user.findFirst({ where: { email: SHARED_EMAIL } })
    );

    expect(a?.name).toBe('Student A');
    expect(b?.name).toBe('Student B');
  });

  it('refuses a second super admin with an existing address', async () => {
    await asSuperAdmin((tx) =>
      tx.user.create({
        data: { email: 'dupe@rls.test', passwordHash: 'x', name: 'Owner One', role: 'SUPER_ADMIN' },
      })
    );

    // Postgres treats NULLs as distinct in a unique index, so
    // @@unique([schoolId, email]) does not cover super admins on its own —
    // a partial unique index in the RLS migration does.
    await expect(
      asSuperAdmin((tx) =>
        tx.user.create({
          data: { email: 'dupe@rls.test', passwordHash: 'x', name: 'Owner Two', role: 'SUPER_ADMIN' },
        })
      )
    ).rejects.toThrow();

    await asSuperAdmin((tx) => tx.user.deleteMany({ where: { email: 'dupe@rls.test' } }));
  });

  it('refuses a school-bound user with no school', async () => {
    await expect(
      asSuperAdmin((tx) =>
        tx.user.create({
          data: { email: 'orphan@rls.test', passwordHash: 'x', name: 'Orphan', role: 'STUDENT' },
        })
      )
    ).rejects.toThrow();
  });
});

describe('the super-admin escape hatch', () => {
  it('sees across tenants', async () => {
    const all = await asSuperAdmin((tx) =>
      tx.school.findMany({ where: { schoolCode: { in: ['RLS-A', 'RLS-B'] } } })
    );
    expect(all).toHaveLength(2);
  });

  it('does not leak into the next transaction', async () => {
    await asSuperAdmin((tx) => tx.school.findMany());
    const after = await withoutTenant((tx) => tx.school.findMany());
    expect(after).toHaveLength(0);
  });
});

describe('audit log', () => {
  it('is append-only', async () => {
    await withTenant(schoolA.id, (tx) =>
      tx.auditLog.create({ data: { schoolId: schoolA.id, action: 'TEST', entity: 'check' } })
    );

    // No DELETE or UPDATE policy exists, so the rows are simply invisible to
    // those statements. Postgres reports 0 rows affected rather than raising —
    // only INSERT and UPDATE can violate a WITH CHECK clause and error.
    const deleted = await withTenant(schoolA.id, (tx) =>
      tx.auditLog.deleteMany({ where: { action: 'TEST' } })
    );
    const updated = await withTenant(schoolA.id, (tx) =>
      tx.auditLog.updateMany({ where: { action: 'TEST' }, data: { action: 'TAMPERED' } })
    );
    const remaining = await withTenant(schoolA.id, (tx) =>
      tx.auditLog.count({ where: { action: 'TEST' } })
    );

    expect(deleted.count).toBe(0);
    expect(updated.count).toBe(0);
    expect(remaining).toBe(1);
  });
});

/**
 * Requirements §6 — the course hierarchy at the database boundary.
 *
 * school_id is denormalised onto every level so the policies can stay flat.
 * That is only safe if it cannot drift out of step with the parent, so the
 * database enforces it. These tests exist because the failure mode is
 * particularly bad: a lesson carrying school A's id under school B's chapter
 * is a row RLS would then faithfully serve to the WRONG tenant — the isolation
 * mechanism becomes the leak.
 */
describe('course hierarchy', () => {
  const COURSE_TABLES = [
    'courses',
    'modules',
    'chapters',
    'lessons',
    'lesson_items',
    'video_assets',
    'course_assignments',
  ];

  it('has RLS enabled and forced on every new table', async () => {
    const rows = await prisma.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class WHERE relname = ANY(${COURSE_TABLES})`;

    expect(rows).toHaveLength(COURSE_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} has RLS disabled`).toBe(true);
      // FORCE matters: without it the owner bypasses the policy and the
      // whole thing is decorative.
      expect(row.relforcerowsecurity, `${row.relname} does not FORCE RLS`).toBe(true);
    }
  });

  it('grants the application role access to every new table', async () => {
    // Default privileges are keyed to the granting role, so a table the app
    // role cannot touch fails at RUNTIME, not at migration time.
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT DISTINCT table_name FROM information_schema.role_table_grants
       WHERE grantee = 'edusphere_app' AND table_name = ANY(${COURSE_TABLES})`;

    expect(rows.map((r) => r.table_name).sort()).toEqual([...COURSE_TABLES].sort());
  });

  it('hides another school’s course tree', async () => {
    const teacher = await asSuperAdmin((tx) =>
      tx.user.create({
        data: { schoolId: schoolA.id, email: 'author@rls.test', passwordHash: 'x', name: 'A', role: 'TEACHER' },
      })
    );

    const course = await withTenant(schoolA.id, (tx) =>
      tx.course.create({
        data: { schoolId: schoolA.id, title: 'Hidden', slug: 'hidden', createdBy: teacher.id },
      })
    );

    const fromB = await withTenant(schoolB.id, (tx) =>
      tx.course.findUnique({ where: { id: course.id } })
    );
    expect(fromB).toBeNull();

    const withNoTenant = await withoutTenant((tx) => tx.course.findMany());
    expect(withNoTenant).toHaveLength(0);
  });

  it('refuses a module whose parent course is in another school', async () => {
    const teacher = await asSuperAdmin((tx) =>
      tx.user.create({
        data: { schoolId: schoolB.id, email: 'author-b@rls.test', passwordHash: 'x', name: 'B', role: 'TEACHER' },
      })
    );

    const courseB = await withTenant(schoolB.id, (tx) =>
      tx.course.create({
        data: { schoolId: schoolB.id, title: 'B course', slug: 'b-course', createdBy: teacher.id },
      })
    );

    // School A tries to hang a module off school B's course. The parity
    // trigger refuses it; because the parent is also invisible under RLS the
    // refusal reads as "no visible parent", which is the same answer.
    await expect(
      withTenant(schoolA.id, (tx) =>
        tx.module.create({
          data: { schoolId: schoolA.id, courseId: courseB.id, title: 'Smuggled' },
        })
      )
    ).rejects.toThrow();
  });

  it('refuses a video asset on a non-video lesson item', async () => {
    const teacher = await asSuperAdmin((tx) =>
      tx.user.create({
        data: { schoolId: schoolA.id, email: 'kind@rls.test', passwordHash: 'x', name: 'K', role: 'TEACHER' },
      })
    );

    const built = await withTenant(schoolA.id, async (tx) => {
      const course = await tx.course.create({
        data: { schoolId: schoolA.id, title: 'Kinds', slug: 'kinds', createdBy: teacher.id },
      });
      const mod = await tx.module.create({
        data: { schoolId: schoolA.id, courseId: course.id, title: 'M' },
      });
      const chapter = await tx.chapter.create({
        data: { schoolId: schoolA.id, moduleId: mod.id, title: 'C' },
      });
      const lesson = await tx.lesson.create({
        data: { schoolId: schoolA.id, chapterId: chapter.id, title: 'L' },
      });
      const quizItem = await tx.lessonItem.create({
        data: { schoolId: schoolA.id, lessonId: lesson.id, kind: 'QUIZ', title: 'Quiz item' },
      });
      return { quizItem };
    });

    await expect(
      withTenant(schoolA.id, (tx) =>
        tx.videoAsset.create({
          data: { lessonItemId: built.quizItem.id, schoolId: schoolA.id, provider: 'YOUTUBE' },
        })
      )
    ).rejects.toThrow(/kind VIDEO/);
  });

  it('refuses to change an item’s kind out from under its video asset', async () => {
    const teacher = await asSuperAdmin((tx) =>
      tx.user.create({
        data: { schoolId: schoolA.id, email: 'stable@rls.test', passwordHash: 'x', name: 'S', role: 'TEACHER' },
      })
    );

    const item = await withTenant(schoolA.id, async (tx) => {
      const course = await tx.course.create({
        data: { schoolId: schoolA.id, title: 'Stable', slug: 'stable', createdBy: teacher.id },
      });
      const mod = await tx.module.create({
        data: { schoolId: schoolA.id, courseId: course.id, title: 'M' },
      });
      const chapter = await tx.chapter.create({
        data: { schoolId: schoolA.id, moduleId: mod.id, title: 'C' },
      });
      const lesson = await tx.lesson.create({
        data: { schoolId: schoolA.id, chapterId: chapter.id, title: 'L' },
      });
      return tx.lessonItem.create({
        data: {
          schoolId: schoolA.id,
          lessonId: lesson.id,
          kind: 'VIDEO',
          title: 'Video item',
          video: { create: { schoolId: schoolA.id, provider: 'YOUTUBE' } },
        },
      });
    });

    await expect(
      withTenant(schoolA.id, (tx) =>
        tx.lessonItem.update({ where: { id: item.id }, data: { kind: 'ASSIGNMENT' } })
      )
    ).rejects.toThrow(/cannot change kind/);
  });
});
