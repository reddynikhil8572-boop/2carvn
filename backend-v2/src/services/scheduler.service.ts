import { asSuperAdmin } from '../db/tenantContext';
import { getRedis } from '../db/redis';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { recordJobRun } from '../utils/metrics';
import { pruneExpired } from './refreshToken.service';
import { pruneResetTokens } from './passwordReset.service';

/**
 * Recurring housekeeping.
 *
 * Until this existed, `pruneExpired` and `pruneResetTokens` were written and
 * **never called**, `video_events` grew a row per student per ~15 seconds of
 * playback with nothing removing them, and quiz attempts abandoned mid-way sat
 * IN_PROGRESS forever. None of that is a security hole — expired rows authorise
 * nothing — but all of it degrades a database nobody is watching.
 *
 * ## Why in-process rather than a Kubernetes CronJob
 *
 * A CronJob is the more orthodox answer and the manifests could run one. This
 * lives in-process because every job here needs the same database credentials,
 * the same Prisma client and the same tenant-bypass plumbing the API already
 * has; a separate image would duplicate all of it to save nothing. The job
 * definitions are exported, so moving them into a CronJob entrypoint later is a
 * different `main`, not a rewrite.
 *
 * ## Why a lock is not optional
 *
 * The API runs multiple replicas. Without coordination every replica would run
 * every job: three replicas means three concurrent `pg_dump`s competing for I/O
 * and three sets of overlapping DELETEs. Each tick takes a **Redis lock with a
 * TTL** (`SET NX PX`), so exactly one replica runs a given job in a given
 * window, and a replica that dies holding the lock releases it when the TTL
 * expires rather than wedging the schedule permanently.
 *
 * With no Redis — development only — the lock is skipped, because there is only
 * one process to coordinate.
 *
 * ## What is deliberately NOT here: the nightly backup
 *
 * `scripts/backup.sh` must run as the database **owner** (`DIRECT_DATABASE_URL`)
 * — a dump taken as `edusphere_app` is `NOBYPASSRLS`, sees no rows, and succeeds
 * silently with an empty file. See `docs/DATA_PROTECTION.md` §4.
 *
 * The API container holds only the restricted role, on purpose: Phase 1 moved
 * migrations into their own one-shot container precisely so a long-lived
 * internet-facing process would not carry credentials that can DROP the RLS
 * policies. Putting the backup here would hand those credentials straight back.
 *
 * So the backup is a **Kubernetes CronJob** built from the same image as the
 * migrate Job (`k8s/backup-cronjob.yaml`), which already has owner access and
 * `pg_dump`. Same reason the restore rehearsal is not here either.
 *
 * `video_events` retention is out for the same reason, arrived at the hard way:
 * append-only is enforced by revoking DELETE from `edusphere_app`, so the API
 * genuinely cannot prune that table. See `src/scripts/pruneVideoEvents.ts`.
 */

export interface Job {
  name: string;
  /** How often to attempt it. */
  everyMs: number;
  /**
   * Lock lifetime. Must comfortably exceed the job's worst-case runtime: too
   * short and a second replica starts a duplicate while the first is still
   * working, which is the exact failure the lock exists to prevent.
   */
  lockMs: number;
  run: () => Promise<string>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Closes quiz attempts whose window has passed.
 *
 * A student who closes the tab mid-quiz leaves a row IN_PROGRESS. That is not
 * merely untidy: `startAttempt` resumes an open attempt, so without this the
 * student is handed back an attempt whose time expired long ago and is graded
 * as EXPIRED the moment they submit. Closing them promptly means their next
 * visit starts a fresh attempt.
 */
export const expireStaleQuizAttempts = async (): Promise<number> =>
  // Cross-tenant by nature, so it needs the sanctioned bypass — see the note in
  // pruneVideoEvents about why the bare client silently affects zero rows.
  asSuperAdmin(
    (tx) => tx.$executeRaw`
      UPDATE quiz_attempts
         SET status = 'EXPIRED', updated_at = now()
       WHERE status = 'IN_PROGRESS'
         AND expires_at IS NOT NULL
         AND expires_at < now()`
  );

/**
 * The job table. Exported so tests can invoke a job directly without waiting
 * for a timer, and so a CronJob entrypoint could import one by name.
 */
export const JOBS: Job[] = [
  {
    name: 'prune-refresh-tokens',
    everyMs: 6 * HOUR,
    lockMs: 5 * MINUTE,
    run: async () => `${await pruneExpired()} expired refresh tokens removed`,
  },
  {
    name: 'prune-reset-tokens',
    everyMs: 6 * HOUR,
    lockMs: 5 * MINUTE,
    run: async () => `${await pruneResetTokens()} spent reset tokens removed`,
  },
  {
    name: 'expire-quiz-attempts',
    // Frequent and cheap. A student returning to an abandoned attempt within
    // the hour is the case this is protecting.
    everyMs: 15 * MINUTE,
    lockMs: 2 * MINUTE,
    run: async () => `${await expireStaleQuizAttempts()} stale quiz attempts closed`,
  },
  // NOTE: `video_events` retention is deliberately NOT here. UPDATE and DELETE
  // are revoked from edusphere_app to enforce append-only, so the API cannot
  // prune it — correctly. That sweep runs as a one-shot with owner credentials:
  // src/scripts/pruneVideoEvents.ts, scheduled by k8s/retention-cronjob.yaml.
];

/**
 * Takes a distributed lock for one job window.
 *
 * `SET key NX PX` is the whole mechanism: atomic, self-expiring, and good
 * enough for work that is idempotent anyway. The lock is **not** released on
 * completion — it is left to expire — so the TTL doubles as the minimum spacing
 * between runs and a crashed replica cannot cause a stampede on restart.
 */
const tryAcquire = async (job: Job): Promise<boolean> => {
  const redis = getRedis();
  if (!redis) return true; // single process; nothing to coordinate

  const result = await redis.set(`edusphere:sched:${job.name}`, process.pid.toString(), {
    NX: true,
    PX: job.lockMs,
  });

  return result === 'OK';
};

const runJob = async (job: Job): Promise<void> => {
  if (!(await tryAcquire(job))) return; // another replica has this window

  const startedAt = Date.now();
  try {
    const summary = await job.run();
    recordJobRun(job.name, 'success');
    logger.info(`scheduler: ${job.name} — ${summary} (${Date.now() - startedAt}ms)`);
  } catch (error) {
    // A failing job must never take the process down: the API is serving
    // traffic, and housekeeping is not worth an outage. It is logged at error
    // level AND counted, so "the prune has been failing for a week" is
    // answerable from metrics rather than only from log archaeology.
    recordJobRun(job.name, 'failure');
    logger.error(`scheduler: ${job.name} failed — ${(error as Error).message}`);
  }
};

const timers: NodeJS.Timeout[] = [];

/**
 * Starts the schedule. Returns a stop function for tests and shutdown.
 *
 * Jobs are **not** run immediately on boot. A deploy that restarts every
 * replica would otherwise fire every job at once across all of them, which is
 * the worst possible moment — the locks would hold, but the first window after
 * a rollout is exactly when the database is busiest.
 */
export const startScheduler = (): (() => void) => {
  if (!config.schedulerEnabled) {
    logger.info('scheduler: disabled (SCHEDULER_ENABLED=false)');
    return () => undefined;
  }

  for (const job of JOBS) {
    const timer = setInterval(() => void runJob(job), job.everyMs);
    // Do not hold the event loop open on account of housekeeping.
    timer.unref();
    timers.push(timer);
  }

  logger.info(
    `scheduler: started with ${JOBS.length} jobs (${JOBS.map((j) => j.name).join(', ')})`
  );

  return () => {
    for (const timer of timers) clearInterval(timer);
    timers.length = 0;
  };
};

/** Runs every job once, in order. Used by tests and by an ops one-shot. */
export const runAllJobsOnce = async (): Promise<void> => {
  for (const job of JOBS) await runJob(job);
};
