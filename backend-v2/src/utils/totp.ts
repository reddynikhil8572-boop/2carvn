import crypto from 'node:crypto';

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), plus the base32 alphabet (RFC 4648)
 * that authenticator apps expect.
 *
 * Written here rather than pulled from a package: the algorithm is an HMAC and
 * a modulo, the base32 codec is a bit-shifting loop, and both are pinned by
 * published test vectors that tests/totp.test.ts asserts against. A dependency
 * would add a supply-chain path straight through the authentication factor to
 * save about eighty lines.
 */

/** Seconds per code. 30 is what every authenticator app assumes. */
export const STEP_SECONDS = 30;

/**
 * How many steps either side of "now" are accepted.
 *
 * Phone clocks drift and users type slowly. One step each way gives a 90-second
 * acceptance band, the usual compromise; widening it multiplies the number of
 * codes an attacker may guess at any instant.
 */
export const DRIFT_STEPS = 1;

const DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const toBase32 = (buf: Buffer): string => {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return out; // unpadded: authenticator apps accept it and QR payloads stay shorter
};

export const fromBase32 = (input: string): Buffer => {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 character in TOTP secret');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
};

/** 20 random bytes — the SHA-1 block size RFC 4226 recommends. */
export const generateSecret = (): string => toBase32(crypto.randomBytes(20));

/** The RFC 6238 time step a given moment falls in. */
export const stepFor = (at: Date = new Date()): number =>
  Math.floor(at.getTime() / 1000 / STEP_SECONDS);

/**
 * HOTP for one counter value. SHA-1 is specified by RFC 4226 and is what every
 * authenticator implements; its collision weaknesses do not apply to HMAC.
 */
export const codeForStep = (secretBase32: string, step: number): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = crypto.createHmac('sha1', fromBase32(secretBase32)).update(counter).digest();

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
};

export interface VerifyOptions {
  /**
   * Highest step already spent. Codes at or below it are refused even when
   * otherwise valid, which is what makes a code single-use rather than valid
   * for its entire window.
   */
  lastUsedStep?: number | null;
  at?: Date;
}

export type TotpResult = { ok: true; step: number } | { ok: false; reason: 'invalid' | 'replayed' };

/**
 * Checks a submitted code against the drift window.
 *
 * Returns the matched step so the caller can persist it; a verify that does not
 * record the step leaves the code replayable for the rest of its window.
 */
export const verifyTotp = (
  secretBase32: string,
  submitted: string,
  { lastUsedStep = null, at = new Date() }: VerifyOptions = {}
): TotpResult => {
  const cleaned = submitted.replace(/\D/g, '');
  if (cleaned.length !== DIGITS) return { ok: false, reason: 'invalid' };

  const current = stepFor(at);

  for (let offset = -DRIFT_STEPS; offset <= DRIFT_STEPS; offset += 1) {
    const step = current + offset;
    const expected = codeForStep(secretBase32, step);

    // Constant-time: a byte-by-byte early exit would leak how much of the code
    // was right, and six digits is a small enough space for that to matter.
    const matches = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned));
    if (!matches) continue;

    if (lastUsedStep !== null && step <= lastUsedStep) {
      return { ok: false, reason: 'replayed' };
    }
    return { ok: true, step };
  }

  return { ok: false, reason: 'invalid' };
};

/**
 * The otpauth:// URI an authenticator scans.
 *
 * The label carries the account and issuer so a user with several EduSphere
 * accounts (a teacher who is also a parent, say) can tell the entries apart.
 */
export const otpauthUri = (params: {
  secret: string;
  accountName: string;
  issuer: string;
}): string => {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
};
