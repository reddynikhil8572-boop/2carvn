/**
 * Runs inside every test worker before the test file is imported. Points the
 * app at the dedicated test database created by globalSetup, never the
 * development one.
 *
 * NODE_ENV=test keeps rate limiters and secure-cookie flags off, which is what
 * the functional suite wants. Production-mode behaviour is covered separately
 * by scripts/e2e-check.sh against the containerised stack.
 */
import { appTestUrl } from './dbUrls';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = appTestUrl;
process.env.DIRECT_DATABASE_URL = appTestUrl;
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.CORS_ORIGIN ||= 'http://localhost:3000';
// A fixed key, so an encrypted secret written by one test file is readable by
// another. Base64 of 32 bytes; the value is meaningless outside the suite.
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');

// Forced empty, not defaulted: `.env` sets SMTP_HOST for local development, and
// inheriting it would send real messages to whatever is listening — and leave
// the in-process outbox the reset tests read from empty.
process.env.SMTP_HOST = '';

// Object storage. Inherited from `.env` here rather than forced, unlike SMTP
// above — the compose MinIO container IS what the tests should write to, and
// there is no in-process equivalent to fall back on. The bucket is created by
// the `minio-init` compose service.
//
// `tests/storage.test.ts` asserts storage is reachable before anything else, so
// an unconfigured environment fails loudly instead of passing vacuously.
process.env.S3_ENDPOINT ||= 'http://localhost:59000';
process.env.S3_BUCKET ||= 'edusphere';
process.env.S3_ACCESS_KEY_ID ||= 'edusphere';
process.env.S3_SECRET_ACCESS_KEY ||= 'edusphere-secret';
process.env.S3_REGION ||= 'auto';
process.env.S3_FORCE_PATH_STYLE ||= 'true';
// The suite talks to storage directly, so there is no separate browser host to
// rewrite to. Forced empty so a value in `.env` cannot redirect the signed URLs
// the tests then fetch.
process.env.S3_PUBLIC_ENDPOINT = '';

// Malware scanning. Inherited rather than defaulted: clamd takes minutes to
// load its signature database, so requiring it would make every test run depend
// on a slow container. When it IS set the EICAR test runs for real; when it is
// not, that test skips and `says plainly whether scanning is on` records which
// way the suite went — so a skip is visible rather than mistaken for coverage.
//
//   docker compose up -d clamav
//   CLAMAV_HOST=localhost CLAMAV_PORT=13310 npm test
