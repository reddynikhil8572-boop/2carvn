/**
 * Retention sweep for `video_events`. Run as a scheduled one-shot, NOT from the
 * API — see below.
 *
 *   npx ts-node src/scripts/pruneVideoEvents.ts      (or the compiled dist/)
 *
 * ## Why this is a separate script rather than a scheduler job
 *
 * `video_events` is append-only and that is enforced two ways: no RLS policy
 * exists FOR UPDATE or DELETE, and `UPDATE`/`DELETE` are **revoked** from
 * `edusphere_app` outright (migration `20260805140935_video_tracking`).
 *
 * Which means the API physically cannot prune it — and that is the correct
 * outcome, not an obstacle to route around. The alternative was to grant the
 * application role DELETE on the audit log of student viewing behaviour, which
 * would have traded a real guarantee for the convenience of one cron entry.
 *
 * So retention runs with the **owner** credentials (`DIRECT_DATABASE_URL`), in a
 * short-lived process, exactly like `scripts/backup.sh`. The API keeps only the
 * restricted role, which is the whole point of the two-role split.
 *
 * The first version of this ran inside the API scheduler. It failed with
 * `permission denied for table video_events`, which is the append-only
 * enforcement working as designed.
 */
import { PrismaClient } from '@prisma/client';
import { config } from '../config/env';

const DAY_MS = 24 * 60 * 60 * 1000;

const main = async (): Promise<void> => {
  const ownerUrl = config.directDatabaseUrl || config.databaseUrl;

  if (!config.directDatabaseUrl) {
    console.warn(
      'DIRECT_DATABASE_URL is not set; falling back to DATABASE_URL. If that is the ' +
        'restricted role this will fail with "permission denied for table video_events", ' +
        'because append-only is enforced by revoking DELETE from it.'
    );
  }

  // Its own client on the owner URL. Deliberately not the shared `prisma`
  // singleton, which is bound to the restricted role.
  const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  const cutoff = new Date(Date.now() - config.videoEventRetentionDays * DAY_MS);
  let removedTotal = 0;

  try {
    // Batched: an unbounded DELETE across months of rows means a long
    // transaction holding locks on a table being written to constantly. Looping
    // in bounded chunks drains a backlog without stalling playback.
    for (;;) {
      const removed = await db.$executeRaw`
        DELETE FROM video_events
         WHERE id IN (
           SELECT id FROM video_events
            WHERE occurred_at < ${cutoff}
            LIMIT ${config.videoEventPruneBatch}
         )`;

      removedTotal += removed;
      if (removed < config.videoEventPruneBatch) break;
    }

    console.log(
      `Pruned ${removedTotal} video_events older than ${config.videoEventRetentionDays} days ` +
        `(before ${cutoff.toISOString()}).`
    );
  } finally {
    await db.$disconnect();
  }
};

void main().catch((error) => {
  console.error('video_events retention sweep failed:', error);
  process.exit(1);
});
