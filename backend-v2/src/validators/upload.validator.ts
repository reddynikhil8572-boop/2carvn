import { z } from 'zod';

/** Object storage — presign and confirm. */

/**
 * Note what is absent: a filename and a key.
 *
 * The server names every object (`storage.service.ts`). A client-supplied key
 * could target another school's prefix or overwrite an object something else
 * points at; a client-supplied filename brings path traversal and a
 * content-type guess taken from an attacker's extension. Only the content type
 * is accepted, and only to be checked against a per-kind allow-list.
 */
export const presignSchema = z
  .object({ contentType: z.string().trim().min(1).max(120) })
  .strict();

/**
 * Keys the server issued, handed back after the upload.
 *
 * Validated for shape here and re-checked against the caller's school in
 * `storage.confirmUpload` — a key is the one piece of storage vocabulary a
 * client legitimately holds, so it is also the one thing worth distrusting.
 */
const storageKey = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^schools\/[0-9a-f-]{36}\/(video|submission|cover)s\/[\w.-]+$/i, 'Invalid upload key');

export const confirmSchema = z.object({ key: storageKey }).strict();

/**
 * `durationSeconds` is **nullable, and must stay nullable**.
 *
 * §7's completion rule divides by it, so the value matters — but the client
 * reads it from the file's metadata, and a browser that cannot parse the
 * container has no figure to give. Requiring one would push the client into
 * inventing a number, and a wrong duration is far worse than a missing one: a
 * duration of 1 marks every student complete after a second.
 *
 * Null is handled honestly downstream — `video.service.ts` reports 0% and never
 * completes when the duration is unknown, so the gap is visible rather than
 * confidently wrong.
 */
export const confirmVideoSchema = z
  .object({
    key: storageKey,
    durationSeconds: z.number().int().min(1).max(86_400).nullable(),
  })
  .strict();

export type PresignInput = z.infer<typeof presignSchema>;
export type ConfirmInput = z.infer<typeof confirmSchema>;
export type ConfirmVideoInput = z.infer<typeof confirmVideoSchema>;
