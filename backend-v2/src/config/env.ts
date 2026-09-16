import dotenv from 'dotenv';
import path from 'path';

// Load env files only outside production — hosted platforms inject their own.
//
// `.env` is the base and is also what the Prisma CLI reads, so DATABASE_URL
// must live there for `prisma migrate` to work. `.env.<NODE_ENV>` is an
// optional per-environment override loaded on top.
if (process.env.NODE_ENV !== 'production') {
  const nodeEnv = process.env.NODE_ENV || 'development';
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), `.env.${nodeEnv}`), override: true });
}

/**
 * Required secrets throw during module load. A process that cannot work
 * correctly should not start and accept traffic.
 */
const isProductionEnv = process.env.NODE_ENV === 'production';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`FATAL: ${name} environment variable is required`);
  }
  return value;
};

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),

  // Database. DATABASE_URL must be the restricted, non-superuser role — RLS is
  // silently inert for a superuser. DIRECT_DATABASE_URL is the owner and is
  // used only by `prisma migrate`.
  databaseUrl: required('DATABASE_URL'),
  directDatabaseUrl: process.env.DIRECT_DATABASE_URL || '',

  // Redis — backs rate-limit counters so they are shared across instances.
  // Required in production; see db/redis.ts.
  redisUrl: process.env.REDIS_URL || '',

  // JWT
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtAccessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
  jwtRefreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',

  // Base64 of 32 random bytes: `openssl rand -base64 32`. Encrypts TOTP secrets
  // at rest (utils/crypto.ts). Required in production — without it two-factor
  // enrollment fails rather than storing seeds in the clear.
  encryptionKey: isProductionEnv
    ? required('ENCRYPTION_KEY')
    : process.env.ENCRYPTION_KEY || '',

  // Issuer name shown in authenticator apps next to the account.
  totpIssuer: process.env.TOTP_ISSUER || '2carvn',

  // Outbound mail. SMTP rather than a provider SDK: every provider speaks it,
  // and it lets local development point at a sink container instead of
  // reaching the internet. Required in production — password reset is not
  // optional, and a server that cannot send is a server that silently strands
  // users.
  smtpHost: isProductionEnv ? required('SMTP_HOST') : process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  // Implicit TLS (port 465). On 587 the connection starts plain and upgrades
  // via STARTTLS, which nodemailer does automatically.
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  mailFrom: process.env.MAIL_FROM || '2carvn <no-reply@edusphere.local>',

  /** How long a password-reset link stays usable. */
  passwordResetTtlMinutes: parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '60', 10),

  // CORS — comma-separated exact origins; local dev servers added automatically
  // outside production.
  corsOrigin: (() => {
    const configured = (process.env.CORS_ORIGIN || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (process.env.NODE_ENV === 'production') {
      return configured;
    }

    return Array.from(
      new Set([...configured, 'http://localhost:3000', 'http://127.0.0.1:3000']),
    );
  })(),

  // Optional regex for preview deployments,
  // e.g. CORS_ORIGIN_PATTERN=^https://[a-z0-9-]+-myorg\.vercel\.app$
  corsOriginPattern: process.env.CORS_ORIGIN_PATTERN
    ? new RegExp(process.env.CORS_ORIGIN_PATTERN)
    : null,

  // URLs
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  backendUrl: process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`,

  // Object storage — S3-compatible, so AWS S3, Cloudflare R2 and MinIO are
  // interchangeable and §15's storage mandate is met either way.
  //
  // Required in production, like ENCRYPTION_KEY: a school that uploads a video
  // and later finds it gone is a worse outcome than a process that refuses to
  // start. Outside production an empty endpoint means "no storage", and the
  // upload endpoints answer 501 rather than failing at the SDK.
  s3Endpoint: isProductionEnv ? required('S3_ENDPOINT') : process.env.S3_ENDPOINT || '',
  s3Region: process.env.S3_REGION || 'auto',
  s3Bucket: isProductionEnv ? required('S3_BUCKET') : process.env.S3_BUCKET || '',
  s3AccessKeyId: isProductionEnv
    ? required('S3_ACCESS_KEY_ID')
    : process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: isProductionEnv
    ? required('S3_SECRET_ACCESS_KEY')
    : process.env.S3_SECRET_ACCESS_KEY || '',

  /**
   * MinIO addresses buckets by path (`host/bucket/key`); R2 and S3 use a
   * virtual host (`bucket.host/key`). Getting this wrong produces a signature
   * mismatch rather than a useful error.
   */
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',

  /**
   * Endpoint the *browser* uses, when it differs from the one the API uses.
   * In compose the API reaches MinIO at `http://minio:9000`, a name that does
   * not resolve outside the network — so presigned URLs handed to a browser
   * have to be rewritten to the published host.
   */
  s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT || '',

  /** How long a presigned upload or download URL stays usable. */
  s3UploadTtlSeconds: parseInt(process.env.S3_UPLOAD_TTL_SECONDS || '900', 10),
  s3DownloadTtlSeconds: parseInt(process.env.S3_DOWNLOAD_TTL_SECONDS || '21600', 10),

  // Housekeeping — services/scheduler.service.ts.
  //
  // Defaults ON. The failure mode of forgetting to enable it is silent: tokens
  // accumulate, video_events grows without bound, and nothing complains until
  // the table is large. Opting out is the deliberate act.
  schedulerEnabled: process.env.SCHEDULER_ENABLED !== 'false',

  /**
   * How long raw `video_events` are kept.
   *
   * These are the append-only log behind §7, at roughly one row per student per
   * 15 seconds of playback — the fastest-growing table in the product by a wide
   * margin. `video_progress` is unaffected and keeps the per-student totals, so
   * pruning the log loses the ability to re-derive history, not the current
   * figures. 90 days is a guess that should be revisited against the retention
   * policy in docs/DATA_PROTECTION.md.
   */
  videoEventRetentionDays: parseInt(process.env.VIDEO_EVENT_RETENTION_DAYS || '90', 10),

  /** Rows removed per pass, so a large backlog drains without long locks. */
  videoEventPruneBatch: parseInt(process.env.VIDEO_EVENT_PRUNE_BATCH || '10000', 10),

  // Malware scanning for uploads (ClamAV clamd).
  //
  // Unset means uploads are NOT scanned, and the service logs a warning once
  // saying so. Set but unreachable means uploads are REJECTED — see
  // services/malwareScan.service.ts for why those two cases differ.
  //
  // Deliberately not `required()` in production: a school running without a
  // scanner is a documented risk they can accept, whereas a boot loop because
  // clamd is slow to start is an outage they cannot.
  clamavHost: process.env.CLAMAV_HOST || '',
  clamavPort: parseInt(process.env.CLAMAV_PORT || '3310', 10),
  /** Generous: a 2 GB video takes a while to stream through clamd. */
  clamavTimeoutMs: parseInt(process.env.CLAMAV_TIMEOUT_MS || '120000', 10),
};
