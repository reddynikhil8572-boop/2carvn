import { createHash } from 'node:crypto';
import { rateLimit, ipKeyGenerator, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/responseFormat';
import { config } from '../config/env';
import { getRedis } from '../db/redis';

const isProduction = config.nodeEnv === 'production';

// Disabled outside production so local development is never throttled.
const passthrough = (_req: Request, _res: Response, next: NextFunction) => next();

const inProduction = <T extends (...args: any[]) => any>(limiter: T) =>
  isProduction ? limiter : passthrough;

/**
 * Counters live in Redis so they are shared across API instances. The default
 * MemoryStore counts per process: run three replicas and the effective limit
 * triples, and every deploy resets the window — which is close to not having a
 * limiter at all.
 *
 * The client is resolved per command rather than captured at module load,
 * because limiters are constructed while the module graph is still being
 * evaluated and Redis connects later during startup.
 */
const makeStore = (prefix: string): Store | undefined => {
  if (!config.redisUrl) return undefined; // MemoryStore; dev only, see db/redis.ts

  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => {
      const client = getRedis();
      if (!client) {
        // Refuse rather than silently degrading to unlimited.
        return Promise.reject(new Error('Redis unavailable for rate limiting'));
      }
      return client.sendCommand(args) as Promise<any>;
    },
  });
};

/**
 * Per-account login throttle.
 *
 * Keyed by IP *and* account, not IP alone. A school is exactly the case where
 * hundreds of users share one public address: an IP-only limit of a handful of
 * attempts would lock out an entire institution the moment morning
 * registration started. Keying by account means guessing one password cannot
 * deny service to everyone else behind the same NAT.
 *
 * Account lockout after 3 failures (auth.service.ts) is the primary defence;
 * this is the layer above it.
 */
export const loginLimiter = inProduction(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore('rl:login:'),
    keyGenerator: (req: Request) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
      const school = typeof req.body?.schoolCode === 'string' ? req.body.schoolCode : '';
      // ipKeyGenerator normalises IPv6 to a /64; a raw req.ip would let anyone
      // with a v6 range sidestep the limit by changing the last hextet.
      return `${ipKeyGenerator(req.ip ?? '')}:${school}:${email}`;
    },
    message: errorResponse('Too many attempts for this account. Try again shortly.') as any,
  })
);

/**
 * Per-IP backstop across all auth endpoints. Loose enough for a whole school
 * behind one address, tight enough to blunt credential spraying across many
 * different accounts from one source.
 */
export const authIpLimiter = inProduction(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore('rl:authip:'),
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
    message: errorResponse('Too many authentication requests, please try again later.') as any,
  })
);

/**
 * Second-factor attempts.
 *
 * A six-digit code is a million possibilities, but with a 90-second acceptance
 * window an unthrottled attacker holding a stolen password gets unlimited
 * guesses at three live codes. Account lockout does not help — the password
 * already succeeded, so the failure counters were reset.
 *
 * Keyed by the challenge token, which identifies one login attempt: a genuine
 * user mistyping their code is not affected by anyone else's attempts, and an
 * attacker cannot reset the budget without going back through the password.
 */
export const twoFactorLimiter = inProduction(
  rateLimit({
    windowMs: 5 * 60 * 1000, // matches the challenge token's lifetime
    limit: 6,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore('rl:2fa:'),
    keyGenerator: (req: Request) => {
      const token = typeof req.body?.challengeToken === 'string' ? req.body.challengeToken : '';
      // Hash it: the raw token is a credential and rate-limit keys end up in
      // Redis, and in Redis's slow log.
      const fingerprint = token
        ? createHash('sha256').update(token).digest('hex').slice(0, 32)
        : 'anonymous';
      return `${ipKeyGenerator(req.ip ?? '')}:${fingerprint}`;
    },
    message: errorResponse('Too many attempts. Please sign in again.') as any,
  })
);

/**
 * Password-reset requests, keyed by the target address so one mailbox cannot
 * be flooded, plus the IP backstop above.
 */
export const passwordResetLimiter = inProduction(
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore('rl:pwreset:'),
    keyGenerator: (req: Request) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
      return `${ipKeyGenerator(req.ip ?? '')}:${email}`;
    },
    message: errorResponse('Too many reset requests. Please try again later.') as any,
  })
);

/**
 * Global limiter. Per-IP too, so it must accommodate a shared school address —
 * a blunt abuse stop, not a fairness mechanism.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore('rl:global:'),
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ''),
  message: errorResponse('Too many requests, please try again later.') as any,
});
