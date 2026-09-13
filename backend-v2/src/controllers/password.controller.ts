import { Request, Response, NextFunction } from 'express';
import { requestReset, completeReset } from '../services/passwordReset.service';
import { clearCookies } from './auth.controller';
import { successResponse, errorResponse } from '../utils/responseFormat';
import type { ForgotPasswordInput, ResetPasswordInput } from '../validators/auth.validator';

/**
 * Password reset — requirements §13.
 *
 * Both endpoints are anonymous by necessity: someone who has forgotten their
 * password cannot authenticate to ask for a new one.
 */

/**
 * POST /api/v1/auth/password/forgot
 *
 * Always 200, always the same message, whether or not the address exists.
 * A "no such account" response would let anyone confirm which addresses belong
 * to a school — a roster of children, in this product — and would do so faster
 * than any rate limit could stop.
 */
export const forgot = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolCode, email } = req.body as ForgotPasswordInput;

    // Awaited rather than fired and forgotten: sending is best-effort inside
    // the service and never throws, and awaiting keeps the response time from
    // depending on whether an email was actually sent.
    await requestReset(schoolCode, email);

    res
      .status(200)
      .json(
        successResponse(
          null,
          'If that account exists, a reset link is on its way. Check your inbox.'
        )
      );
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/password/reset
 *
 * Consumes the emailed token and sets the new password. Every existing session
 * is revoked, including the caller's, so the response also clears cookies —
 * otherwise the browser keeps sending a refresh cookie that can no longer work.
 */
export const reset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token, password } = req.body as ResetPasswordInput;
    const result = await completeReset(token, password);

    if (!result.ok) {
      // One message for all three cases. Distinguishing "expired" from "already
      // used" from "never existed" tells someone holding a stolen link which
      // kind of failure they are looking at.
      res
        .status(400)
        .json(
          errorResponse('This reset link is no longer valid. Please request a new one.', {
            code: 'RESET_TOKEN_INVALID',
          })
        );
      return;
    }

    clearCookies(res);

    res
      .status(200)
      .json(successResponse(null, 'Your password has been changed. Please sign in again.'));
  } catch (error) {
    next(error);
  }
};
