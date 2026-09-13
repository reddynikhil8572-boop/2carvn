/**
 * Prints a valid TOTP code for a base32 secret. Used by e2e-check.sh, which
 * has to produce a real second factor against the running API.
 *
 * A file rather than `ts-node -e`: eval mode writes nothing at all when its
 * stdout is captured by a command substitution, which is exactly how the shell
 * script needs to call it.
 *
 *   npx ts-node scripts/totp-code.ts <base32-secret> [step-offset]
 */
import { codeForStep, stepFor } from '../src/utils/totp';

const [secret, offset] = process.argv.slice(2);

if (!secret) {
  console.error('usage: totp-code.ts <base32-secret> [step-offset]');
  process.exit(1);
}

console.log(codeForStep(secret, stepFor() + Number(offset ?? 0)));
