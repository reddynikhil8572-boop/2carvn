import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ownerTestUrl } from './dbUrls';

/**
 * `prisma/sql/app-role-privileges.sql` must stay equal to what the migrations
 * actually produce.
 *
 * Why this test exists: backup.sh dumps with --no-owner --no-privileges, so a
 * restored database has every row and not one GRANT. The 2026-08-06 rehearsal
 * measured it — 102 grants in the source, 0 in the restore. `migrate deploy`
 * cannot repair that, because the restored `_prisma_migrations` says all
 * migrations are applied. So restore.sh applies that file instead, and the
 * file is a *hand-maintained reconstruction* of an end state currently spread
 * across seven migrations.
 *
 * A reconstruction that nothing checks is a reconstruction that drifts. The
 * failure it drifts into is not loud: a future migration grants access to a
 * new table, nobody updates the file, and six months later a restore comes up
 * with an application that can read everything except the one table added in
 * March. Or worse in the other direction — the file re-grants something a
 * migration deliberately revoked, and the restored system quietly loses the
 * append-only guarantee on video_events.
 *
 * The check: strip the role of everything, re-apply the file, and assert the
 * privileges that come back are byte-for-byte the set the migrations left.
 * Stripping first is what makes it two-sided — comparing without stripping
 * would pass no matter what the file omitted, since GRANT only ever adds.
 *
 * All of it inside a transaction that is rolled back. GRANT/REVOKE are
 * transactional in Postgres, and vitest runs these files serially
 * (`fileParallelism: false`), so nothing else observes the stripped state.
 */

const owner = new PrismaClient({ datasourceUrl: ownerTestUrl });

const PRIV_SQL = path.resolve(process.cwd(), 'prisma/sql/app-role-privileges.sql');

/**
 * Every privilege the role holds, as a sorted, comparable list. Tables,
 * routines and schema usage — the three the file grants — so an omission in
 * any of them shows up as a diff rather than a silent pass.
 */
const SNAPSHOT = `
  SELECT string_agg(entry, E'\\n' ORDER BY entry) AS snapshot FROM (
    SELECT 'table:' || table_name || ':' || privilege_type AS entry
      FROM information_schema.role_table_grants WHERE grantee = 'edusphere_app'
    UNION ALL
    SELECT 'routine:' || routine_name || ':' || privilege_type
      FROM information_schema.role_routine_grants WHERE grantee = 'edusphere_app'
    UNION ALL
    -- The schema ACL is read directly rather than through
    -- has_schema_privilege(). That function answers "can this role use the
    -- schema", and in Postgres the PUBLIC pseudo-role holds USAGE on "public"
    -- by default — so it returns true even for a role that has been stripped
    -- of every grant of its own, and the check would be vacuous. Only grants
    -- made specifically to edusphere_app count here.
    SELECT 'schema:' || n.nspname || ':' || acl.privilege_type
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(n.nspacl) AS acl
     WHERE n.nspname = 'public' AND acl.grantee = 'edusphere_app'::regrole
  ) AS privileges
`;

/**
 * Splits the file into statements Prisma will accept.
 *
 * `$executeRawUnsafe` goes through a prepared statement, and Postgres refuses
 * more than one command in one of those — psql, which is what restore.sh uses,
 * has no such limit.
 *
 * Only semicolons at the top level end a statement. Three regions have to be
 * skipped over, and all three are present in that file: `DO $$ ... $$` blocks,
 * single-quoted strings, and `--` comments. The first version tracked only
 * dollar quotes and split the header comment in half at "Idempotent; safe to
 * run on a live database", handing Postgres the fragment "safe to run...".
 */
const splitStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let tag: string | null = null;
  let inString = false;
  let inComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];

    if (inComment) {
      if (char === '\n') inComment = false;
    } else if (inString) {
      // '' is an escaped quote, not the end of the string.
      if (char === "'" && sql[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      if (char === "'") inString = false;
    } else if (tag !== null) {
      if (sql.startsWith(tag, i)) {
        current += tag;
        i += tag.length - 1;
        tag = null;
        continue;
      }
    } else {
      const opening = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (opening) {
        tag = opening[0];
        current += tag;
        i += tag.length - 1;
        continue;
      }
      if (char === '-' && sql[i + 1] === '-') inComment = true;
      else if (char === "'") inString = true;
      else if (char === ';') {
        statements.push(current);
        current = '';
        continue;
      }
    }

    current += char;
  }
  statements.push(current);

  // Drop blank and comment-only fragments; the file is mostly commentary.
  return statements
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.split('\n').some((line) => !/^\s*(--.*)?$/.test(line)));
};

afterAll(async () => {
  await owner.$disconnect();
});

describe('prisma/sql/app-role-privileges.sql', () => {
  it('reproduces exactly the privileges the migrations grant', async () => {
    const script = fs.readFileSync(PRIV_SQL, 'utf8');

    const rollback = new Error('__rollback__');
    let before = '';
    let after = '';

    try {
      await owner.$transaction(
        async (tx) => {
          [{ snapshot: before }] = await tx.$queryRawUnsafe<{ snapshot: string }[]>(SNAPSHOT);

          // Strip the role bare. Without this the comparison is vacuous:
          // re-applying grants on top of existing ones cannot reveal anything
          // the file forgot to include.
          for (const scope of [
            'ALL TABLES IN SCHEMA public',
            'ALL SEQUENCES IN SCHEMA public',
            'ALL FUNCTIONS IN SCHEMA public',
            'SCHEMA public',
          ]) {
            await tx.$executeRawUnsafe(`REVOKE ALL ON ${scope} FROM edusphere_app`);
          }

          const [{ snapshot: stripped }] = await tx.$queryRawUnsafe<{ snapshot: string | null }[]>(
            SNAPSHOT
          );
          // Guard against the guard: if REVOKE quietly did nothing, everything
          // below would pass while testing nothing at all.
          expect(stripped, 'REVOKE left privileges behind, so this test proves nothing').toBeNull();

          for (const statement of splitStatements(script)) {
            await tx.$executeRawUnsafe(statement);
          }

          [{ snapshot: after }] = await tx.$queryRawUnsafe<{ snapshot: string }[]>(SNAPSHOT);

          throw rollback;
        },
        { timeout: 30_000 }
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }

    expect(before).not.toBe('');
    expect(after.split('\n')).toEqual(before.split('\n'));
  });

  // The two below read the live migrated database, not the file — they pin the
  // end state the file is measured against, so a migration that relaxed either
  // property fails here first. They do NOT guard the file itself; the diff
  // above is the only thing that does. Verified by deleting the video_events
  // REVOKE from the file: the diff failed and both of these still passed.
  it('the migrations leave video_events append-only', async () => {
    // Stated separately from the diff because this is the property with
    // consequences: the application writes the record of what a child watched
    // and must not be able to edit or erase it afterwards.
    const rows = await owner.$queryRawUnsafe<{ privilege_type: string }[]>(`
      SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'edusphere_app' AND table_name = 'video_events'
    `);

    const granted = rows.map((r) => r.privilege_type).sort();
    expect(granted).toEqual(['INSERT', 'SELECT']);
  });

  it('the migrations grant the application nothing on Prisma bookkeeping', async () => {
    const rows = await owner.$queryRawUnsafe<{ privilege_type: string }[]>(`
      SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'edusphere_app' AND table_name = '_prisma_migrations'
    `);

    expect(rows).toEqual([]);
  });
});
