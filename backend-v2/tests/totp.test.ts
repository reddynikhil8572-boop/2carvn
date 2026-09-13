import { describe, it, expect } from 'vitest';
import {
  toBase32,
  fromBase32,
  codeForStep,
  stepFor,
  verifyTotp,
  generateSecret,
  otpauthUri,
  STEP_SECONDS,
} from '../src/utils/totp';
import { encryptSecret, decryptSecret } from '../src/utils/crypto';

/**
 * The TOTP primitive is hand-rolled, so it is pinned to the published vectors
 * rather than to its own output. An implementation that is self-consistently
 * wrong would pass a round-trip test and then reject every code a real
 * authenticator produces.
 */

// RFC 4226 Appendix D: secret "12345678901234567890", counters 0-9.
const RFC4226_SECRET = toBase32(Buffer.from('12345678901234567890', 'ascii'));
const RFC4226_CODES = [
  '755224', '287082', '359152', '969429', '338314',
  '254676', '287922', '162583', '399871', '520489',
];

describe('base32', () => {
  it('matches RFC 4648 test vectors', () => {
    expect(toBase32(Buffer.from('f'))).toBe('MY');
    expect(toBase32(Buffer.from('fo'))).toBe('MZXQ');
    expect(toBase32(Buffer.from('foo'))).toBe('MZXW6');
    expect(toBase32(Buffer.from('foob'))).toBe('MZXW6YQ');
    expect(toBase32(Buffer.from('fooba'))).toBe('MZXW6YTB');
    expect(toBase32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('round-trips arbitrary bytes', () => {
    const original = Buffer.from([0, 1, 127, 128, 255, 42, 17]);
    expect(fromBase32(toBase32(original)).equals(original)).toBe(true);
  });

  it('ignores the spacing authenticator apps display', () => {
    expect(fromBase32('mzxw 6ytb-oi').toString()).toBe('foobar');
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => fromBase32('MZXW6YTB1')).toThrow(/Invalid base32/);
  });
});

describe('HOTP', () => {
  it('reproduces the RFC 4226 vectors', () => {
    RFC4226_CODES.forEach((expected, counter) => {
      expect(codeForStep(RFC4226_SECRET, counter)).toBe(expected);
    });
  });
});

describe('TOTP', () => {
  // RFC 6238 Appendix B, SHA-1 rows.
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches RFC 6238 at t=%i', (seconds, eightDigit) => {
    const step = Math.floor(seconds / STEP_SECONDS);
    // The RFC prints 8 digits; this implementation emits the 6 that
    // authenticator apps use, which are the low-order six of the same number.
    expect(codeForStep(RFC4226_SECRET, step)).toBe(eightDigit.slice(-6));
  });

  it('accepts the current code', () => {
    const secret = generateSecret();
    const now = new Date();
    expect(verifyTotp(secret, codeForStep(secret, stepFor(now)), { at: now })).toMatchObject({
      ok: true,
    });
  });

  it('tolerates one step of clock drift in each direction', () => {
    const secret = generateSecret();
    const now = new Date();
    const current = stepFor(now);

    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp(secret, codeForStep(secret, current + offset), { at: now }).ok).toBe(true);
    }
  });

  it('rejects codes beyond the drift window', () => {
    const secret = generateSecret();
    const now = new Date();
    const current = stepFor(now);

    for (const offset of [-2, 2, 100]) {
      expect(verifyTotp(secret, codeForStep(secret, current + offset), { at: now })).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
  });

  it('refuses a code at or below the last used step', () => {
    const secret = generateSecret();
    const now = new Date();
    const current = stepFor(now);

    expect(verifyTotp(secret, codeForStep(secret, current), { at: now, lastUsedStep: current })).toEqual(
      { ok: false, reason: 'replayed' }
    );

    // The previous step is still within the drift window, so without the
    // watermark it would be accepted — this is the case that matters.
    expect(
      verifyTotp(secret, codeForStep(secret, current - 1), { at: now, lastUsedStep: current })
    ).toEqual({ ok: false, reason: 'replayed' });
  });

  it('reports the matched step so the caller can record it', () => {
    const secret = generateSecret();
    const now = new Date();
    const step = stepFor(now);
    expect(verifyTotp(secret, codeForStep(secret, step), { at: now })).toEqual({ ok: true, step });
  });

  it('rejects malformed input without throwing', () => {
    const secret = generateSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', '   ']) {
      expect(verifyTotp(secret, bad).ok).toBe(false);
    }
  });

  it('builds an otpauth URI an authenticator can parse', () => {
    const uri = otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', accountName: 'a@b.test', issuer: 'EduSphere' });
    const parsed = new URL(uri);

    expect(parsed.protocol).toBe('otpauth:');
    expect(decodeURIComponent(parsed.pathname)).toBe('/EduSphere:a@b.test');
    expect(parsed.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(parsed.searchParams.get('issuer')).toBe('EduSphere');
    expect(parsed.searchParams.get('digits')).toBe('6');
    expect(parsed.searchParams.get('period')).toBe('30');
  });
});

describe('secret encryption', () => {
  it('round-trips', () => {
    const secret = generateSecret();
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('never emits the plaintext', () => {
    const secret = generateSecret();
    expect(encryptSecret(secret)).not.toContain(secret);
  });

  it('produces a different ciphertext each time', () => {
    // A deterministic ciphertext would let anyone with read access to the table
    // tell which users share a secret, and confirm a guessed one.
    const secret = generateSecret();
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it('refuses tampered ciphertext rather than returning garbage', () => {
    const sealed = encryptSecret(generateSecret());
    const [version, iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data!, 'base64url');
    flipped[0] ^= 0xff;

    expect(() =>
      decryptSecret([version, iv, tag, flipped.toString('base64url')].join('.'))
    ).toThrow();
  });

  it('rejects a malformed envelope', () => {
    expect(() => decryptSecret('not-an-envelope')).toThrow(/Malformed/);
  });
});
