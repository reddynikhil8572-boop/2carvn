import { Router } from 'express';
import { login, refresh, logout, me } from '../controllers/auth.controller';
import {
  verify as verifyTwoFactor,
  status as twoFactorStatus,
  setup as twoFactorSetup,
  enable as twoFactorEnable,
  disable as twoFactorDisable,
  regenerate as twoFactorRegenerate,
} from '../controllers/twoFactor.controller';
import {
  forgot as forgotPassword,
  reset as resetPassword,
} from '../controllers/password.controller';
import { requireAuth } from '../middlewares/auth';
import {
  loginLimiter,
  authIpLimiter,
  twoFactorLimiter,
  passwordResetLimiter,
} from '../middlewares/rateLimiter';
import { validate } from '../middlewares/validate';
import {
  loginSchema,
  twoFactorVerifySchema,
  twoFactorEnableSchema,
  twoFactorDisableSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/auth.validator';

const router = Router();

// Per-IP backstop across every auth route, sized for a school sharing one
// public address. Password guessing is caught by loginLimiter (per account)
// and by account lockout, not by this.
router.use(authIpLimiter);

// validate() runs before loginLimiter so the limiter's key can read a
// normalised email off req.body.
router.post('/login', validate(loginSchema), loginLimiter, login);

// Deliberately not rate-limited per account: every signed-in client refreshes
// on a 15-minute cycle, so a whole school's routine refreshes would otherwise
// exhaust a strict per-IP budget and sign everyone out.
router.post('/refresh', refresh);

router.post('/logout', logout);
router.get('/me', requireAuth, me);

// --- Password reset, §13 -----------------------------------------------------

// Anonymous by necessity. passwordResetLimiter is keyed by IP+email so one
// mailbox cannot be flooded, and authIpLimiter above bounds the whole route
// group. The reset step is not limited per account: the token is 256 bits, and
// throttling it would let anyone lock a victim out of their own reset.
router.post(
  '/password/forgot',
  validate(forgotPasswordSchema),
  passwordResetLimiter,
  forgotPassword
);
router.post('/password/reset', validate(resetPasswordSchema), resetPassword);

// --- Two-factor authentication, §13 -----------------------------------------

// Unauthenticated: this *is* the rest of the login. The challenge token issued
// by /login is what authorises it, and the limiter keys off that token.
router.post(
  '/2fa/verify',
  validate(twoFactorVerifySchema),
  twoFactorLimiter,
  verifyTwoFactor
);

// Enrollment management, all acting on the caller's own account.
router.get('/2fa', requireAuth, twoFactorStatus);
router.post('/2fa/setup', requireAuth, twoFactorSetup);
router.post('/2fa/enable', requireAuth, validate(twoFactorEnableSchema), twoFactorEnable);
router.post('/2fa/disable', requireAuth, validate(twoFactorDisableSchema), twoFactorDisable);
router.post(
  '/2fa/recovery-codes',
  requireAuth,
  validate(twoFactorDisableSchema),
  twoFactorRegenerate
);

export default router;
