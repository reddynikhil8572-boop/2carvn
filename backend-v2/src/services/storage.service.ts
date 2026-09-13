import crypto from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { scanStream, scanningEnabled } from './malwareScan.service';

/**
 * The only module that talks to object storage.
 *
 * S3-compatible throughout, so AWS S3, Cloudflare R2 and the MinIO container
 * used locally are interchangeable — which is what satisfies §15's storage
 * mandate without committing to one vendor.
 *
 * ## Two decisions worth understanding before changing anything here
 *
 * **1. The server names every key.** A client that could choose its own key
 * could write into another school's prefix, or overwrite an object another
 * student's submission points at. This is the same principle that took the
 * quiz start time and the assignment submission time off the client in
 * Phase 2: never let the caller name the thing it has an interest in.
 *
 * **2. Uploads are presigned POST, not presigned PUT.** A POST policy can
 * constrain `content-length-range` and the content type; a bare presigned PUT
 * cannot, so it accepts a five-gigabyte file, or an HTML document that later
 * gets served back. The bytes bypass the API either way, which is the point of
 * presigning at all — a lesson video has no business transiting Node.
 */

const notImplemented = (m: string) => Object.assign(new Error(m), { statusCode: 501 });
const badRequest = (m: string) => Object.assign(new Error(m), { statusCode: 400 });

/** What a file is for. Decides the key prefix and the accepted content types. */
export type UploadKind = 'video' | 'submission' | 'cover';

/**
 * Per-kind limits. Deliberately conservative: these are the numbers a school
 * can live with, not the numbers S3 permits.
 */
const RULES: Record<UploadKind, { maxBytes: number; contentTypes: string[] }> = {
  video: {
    maxBytes: 2 * 1024 * 1024 * 1024, // 2 GB
    contentTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  },
  submission: {
    maxBytes: 25 * 1024 * 1024, // 25 MB
    contentTypes: [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
  cover: {
    maxBytes: 5 * 1024 * 1024, // 5 MB
    contentTypes: ['image/png', 'image/jpeg', 'image/webp'],
  },
};

let client: S3Client | null = null;
let signingClient: S3Client | null = null;

/**
 * Mirrors `encryptionAvailable()` in utils/crypto.ts. Outside production an
 * unconfigured endpoint means "no storage", and callers answer 501 rather than
 * failing somewhere inside the SDK. In production `config/env.ts` has already
 * refused to start.
 */
export const storageAvailable = (): boolean =>
  Boolean(config.s3Endpoint && config.s3Bucket && config.s3AccessKeyId);

const getClient = (): S3Client => {
  if (!storageAvailable()) {
    throw notImplemented('File storage is not configured on this server');
  }

  client ??= new S3Client({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    // MinIO addresses buckets by path; R2 and S3 use a virtual host. The wrong
    // choice produces a signature mismatch rather than a useful message.
    forcePathStyle: config.s3ForcePathStyle,
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
  });

  return client;
};

/**
 * A second client pointed at the endpoint a **browser** can reach.
 *
 * In compose the API talks to `http://minio:9000`, a name that does not resolve
 * outside the network, so a URL signed for that host is useless to a browser.
 *
 * The obvious shortcut — sign against the internal endpoint and swap the host
 * afterwards — **does not work for presigned GETs**: SigV4 always includes
 * `host` among the signed headers, so changing it invalidates the signature.
 * (A presigned POST survives it, because the policy signs the form fields
 * rather than the URL's host. Relying on that difference would be a trap for
 * whoever touched this next.)
 *
 * So anything handed to a browser is signed against the public endpoint from
 * the start. Server-side calls that never leave the network — HeadObject,
 * DeleteObject — keep using the internal one.
 */
const getSigningClient = (): S3Client => {
  if (!config.s3PublicEndpoint || config.s3PublicEndpoint === config.s3Endpoint) {
    return getClient();
  }

  if (!storageAvailable()) {
    throw notImplemented('File storage is not configured on this server');
  }

  signingClient ??= new S3Client({
    endpoint: config.s3PublicEndpoint,
    region: config.s3Region,
    forcePathStyle: config.s3ForcePathStyle,
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
  });

  return signingClient;
};

/**
 * Builds the key. Two properties matter:
 *
 * - It starts with the school id, so a stray listing is at least tenant-shaped
 *   and a bucket policy could be scoped by prefix later.
 * - The filename is a fresh uuid, never anything the client sent. A
 *   client-supplied name brings path traversal, collisions and, if it were ever
 *   served, a content-type guess based on an attacker's extension.
 */
const buildKey = (schoolId: string, kind: UploadKind, contentType: string): string => {
  const extension =
    {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'application/pdf': 'pdf',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'text/plain': 'txt',
    }[contentType] ?? 'bin';

  return `schools/${schoolId}/${kind}s/${crypto.randomUUID()}.${extension}`;
};

/** True when `key` belongs to this school. Guards every read of a stored key. */
export const keyBelongsToSchool = (key: string, schoolId: string): boolean =>
  key.startsWith(`schools/${schoolId}/`);

export interface PresignedUpload {
  key: string;
  url: string;
  fields: Record<string, string>;
  maxBytes: number;
  expiresIn: number;
}

/**
 * Issues a presigned POST for a new object.
 *
 * The returned `key` is what the caller must hand back to `confirmUpload`; the
 * client uploads to `url` with `fields` plus the file, and never learns
 * anything about the bucket beyond that.
 */
export const presignUpload = async (input: {
  schoolId: string;
  kind: UploadKind;
  contentType: string;
}): Promise<PresignedUpload> => {
  const rules = RULES[input.kind];

  if (!rules.contentTypes.includes(input.contentType)) {
    throw badRequest(
      `${input.contentType} is not an accepted type for a ${input.kind} (allowed: ${rules.contentTypes.join(', ')})`
    );
  }

  const key = buildKey(input.schoolId, input.kind, input.contentType);

  const { url, fields } = await createPresignedPost(getSigningClient(), {
    Bucket: config.s3Bucket,
    Key: key,
    Expires: config.s3UploadTtlSeconds,
    // The conditions are the reason POST was chosen over PUT. Storage itself
    // enforces them, so a client that ignores the limits is rejected by S3
    // rather than by a check we have to remember to write.
    Conditions: [
      ['content-length-range', 1, rules.maxBytes],
      ['eq', '$Content-Type', input.contentType],
    ],
    Fields: { 'Content-Type': input.contentType },
  });

  return {
    key,
    url,
    fields,
    maxBytes: rules.maxBytes,
    expiresIn: config.s3UploadTtlSeconds,
  };
};

export interface ConfirmedUpload {
  key: string;
  sizeBytes: number;
  contentType: string | null;
}

const unprocessable = (m: string) => Object.assign(new Error(m), { statusCode: 422 });
const unavailable = (m: string) => Object.assign(new Error(m), { statusCode: 503 });

/**
 * Streams the stored object through the malware scanner and deletes it if it is
 * infected.
 *
 * Deleting matters as much as rejecting: an object left in the bucket after a
 * refused confirm is unreferenced, unnoticed, and still downloadable by anyone
 * who learns its key.
 */
const scanOrReject = async (key: string): Promise<void> => {
  if (!scanningEnabled()) return;

  let verdict;
  try {
    const object = await getClient().send(
      new GetObjectCommand({ Bucket: config.s3Bucket, Key: key })
    );
    verdict = await scanStream(object.Body as Readable);
  } catch (error) {
    // Fail CLOSED. A scanner that is configured but unreachable must not
    // silently become a scanner that is off — that is precisely when you would
    // least want it off and least likely to notice.
    logger.error(`Malware scan failed for ${key}: ${(error as Error).message}`);
    await deleteObject(key);
    throw unavailable('The file could not be virus-scanned; please try again shortly');
  }

  if (!verdict.clean) {
    logger.warn(`Rejected infected upload ${key}: ${verdict.signature}`);
    await deleteObject(key);
    throw unprocessable(`That file was rejected by the virus scanner (${verdict.signature})`);
  }
};

/**
 * Verifies the object is actually there.
 *
 * **Nothing writes a `*_key` column without this.** The upload happens directly
 * between browser and storage, so the API's only evidence that it succeeded is
 * a client saying so — and a client that says so falsely would leave a row
 * pointing at nothing, which surfaces later as a broken video with no
 * explanation.
 *
 * Also re-checks the prefix: `confirmUpload` takes a key from a request body,
 * and a key naming another school is either a bug or an attempt.
 */
export const confirmUpload = async (
  key: string,
  schoolId: string,
  options: { scan?: boolean } = {}
): Promise<ConfirmedUpload> => {
  if (!keyBelongsToSchool(key, schoolId)) {
    throw badRequest('That upload key does not belong to this school');
  }

  try {
    const head = await getClient().send(
      new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key })
    );

    // Scan before returning, so nothing downstream can write a `*_key` column
    // pointing at an object that has not been checked. An infected object is
    // deleted here rather than left in the bucket for someone to stumble on.
    if (options.scan !== false) {
      await scanOrReject(key);
    }

    return {
      key,
      sizeBytes: head.ContentLength ?? 0,
      contentType: head.ContentType ?? null,
    };
  } catch (error) {
    // A rejection we raised ourselves (infected, or scanner down) must pass
    // through unchanged — turning it into "never uploaded" would be a lie.
    if ((error as { statusCode?: number }).statusCode) throw error;

    // A 404 here is the ordinary case — the client never uploaded, or the
    // upload failed. Anything else is worth surfacing in the log.
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (status !== 404 && status !== 403) {
      logger.error(`Storage HeadObject failed for ${key}: ${(error as Error).message}`);
    }
    throw badRequest('That file was never uploaded');
  }
};

/**
 * A short-lived URL for reading one object.
 *
 * Callers MUST have performed the same authorization check that guards the
 * resource before asking for this — the URL itself carries no notion of who
 * requested it, so issuing one is equivalent to handing over the file.
 *
 * `Content-Disposition: attachment` on submissions means a browser downloads
 * rather than renders, which stops an uploaded HTML or SVG file from executing
 * in the origin's context.
 */
export const presignDownload = async (
  key: string,
  options: { attachment?: boolean; filename?: string } = {}
): Promise<string> => {
  return getSignedUrl(
    getSigningClient(),
    new GetObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      ...(options.attachment
        ? {
            ResponseContentDisposition: `attachment; filename="${(options.filename ?? 'file').replace(/[^\w.-]/g, '_')}"`,
          }
        : {}),
    }),
    { expiresIn: config.s3DownloadTtlSeconds }
  );
};

/**
 * Deletes an object. Best-effort: a replaced cover image that lingers is
 * untidy, not broken, so a failure here is logged rather than thrown to a
 * caller who has already succeeded at the thing they asked for.
 */
export const deleteObject = async (key: string): Promise<void> => {
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }));
  } catch (error) {
    logger.warn(`Could not delete ${key}: ${(error as Error).message}`);
  }
};

/**
 * Deletes objects and says which ones actually went.
 *
 * `deleteObject` above is best-effort by design: a replaced cover image that
 * lingers is untidy rather than broken, so it logs and moves on. Erasure
 * cannot use that. "We deleted this child's coursework" has to be a statement
 * someone can stand behind, and a helper that swallows its failures turns a
 * legal answer into a guess.
 *
 * So this reports per key, and treats unconfigured storage as a **failure**
 * rather than a vacuous success — on a server with no bucket the objects were
 * not deleted, and saying otherwise would be the exact false assurance the
 * caller is trying to avoid.
 */
export const deleteObjectsReporting = async (
  keys: string[]
): Promise<{ deleted: string[]; failed: string[] }> => {
  const deleted: string[] = [];
  const failed: string[] = [];

  if (keys.length === 0) return { deleted, failed };

  if (!storageAvailable()) {
    logger.warn(`Storage is not configured; ${keys.length} object(s) were NOT deleted`);
    return { deleted, failed: [...keys] };
  }

  for (const key of keys) {
    try {
      await getClient().send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }));
      deleted.push(key);
    } catch (error) {
      logger.error(`Erasure could not delete ${key}: ${(error as Error).message}`);
      failed.push(key);
    }
  }

  return { deleted, failed };
};

export const STORAGE_RULES = RULES;
