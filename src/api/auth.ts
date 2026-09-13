import { api } from './client';

import type { LoginUser, MeResponse, TwoFactorLoginResponse, TwoFactorSetup, TwoFactorStatus } from '@/types/models';
import type { ApiEnvelope } from '@/types/api';

/**
 * Auth API — wraps every endpoint from backend-v2/src/routes/auth.routes.ts.
 * All mutations extract `data` from the standard `ApiEnvelope` before returning.
 */

// ── Login / logout / session ───────────────────────────────────────────────

export interface LoginPayload {
  schoolCode?: string;
  email: string;
  password: string;
}

/**
 * Backend discriminates on `twoFactorRequired`:
 * - false → session issued, `user` present
 * - true → session withheld, `challengeToken` issued for /auth/2fa/verify
 */
export type LoginResult =
  | { twoFactorRequired: false; user: LoginUser & { email: string } }
  | { twoFactorRequired: true; challengeToken: string; expiresIn: number };

export async function login(payload: LoginPayload): Promise<LoginResult> {
  const res = await api.post<ApiEnvelope<LoginResult>>('/auth/login', payload);
  return res.data.data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function refreshSession(): Promise<boolean> {
  try {
    const res = await api.post('/auth/refresh');
    return res.data.success === true;
  } catch {
    return false;
  }
}

export async function getMe(): Promise<MeResponse> {
  const res = await api.get<ApiEnvelope<MeResponse>>('/auth/me');
  return res.data.data;
}

// ── Password reset ─────────────────────────────────────────────────────────

export interface ForgotPasswordPayload {
  schoolCode?: string;
  email: string;
}

export async function requestPasswordReset(payload: ForgotPasswordPayload): Promise<{ success: boolean }> {
  const res = await api.post('/auth/password/forgot', payload);
  return res.data;
}

export interface ResetPasswordPayload {
  token: string;
  password: string;
}

export async function resetPassword(payload: ResetPasswordPayload): Promise<{ success: boolean }> {
  const res = await api.post('/auth/password/reset', payload);
  return res.data;
}

// ── Two-factor authentication ──────────────────────────────────────────────

export interface TwoFactorVerifyPayload {
  challengeToken: string;
  code: string;
}

export async function verifyTwoFactor(payload: TwoFactorVerifyPayload): Promise<TwoFactorLoginResponse> {
  const res = await api.post<ApiEnvelope<TwoFactorLoginResponse>>('/auth/2fa/verify', payload);
  return res.data.data;
}

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  const res = await api.get<ApiEnvelope<TwoFactorStatus>>('/auth/2fa');
  return res.data.data;
}

export async function setupTwoFactor(): Promise<TwoFactorSetup> {
  const res = await api.post<ApiEnvelope<TwoFactorSetup>>('/auth/2fa/setup');
  return res.data.data;
}

export interface EnableTwoFactorPayload {
  code: string;
}

/**
 * Enable returns the recovery codes exactly once — the backend stores only
 * their digests, so this response is the user's only chance to record them.
 */
export async function enableTwoFactor(payload: EnableTwoFactorPayload): Promise<{ recoveryCodes: string[] }> {
  const res = await api.post<ApiEnvelope<{ recoveryCodes: string[] }>>('/auth/2fa/enable', payload);
  return res.data.data;
}

export interface DisableTwoFactorPayload {
  password: string;
}

export async function disableTwoFactor(payload: DisableTwoFactorPayload): Promise<void> {
  const res = await api.post('/auth/2fa/disable', payload);
  return res.data.data;
}

export interface RegenerateRecoveryCodesPayload {
  password: string;
}

export async function regenerateRecoveryCodes(payload: RegenerateRecoveryCodesPayload): Promise<{
  recoveryCodes: string[];
}> {
  const res = await api.post<ApiEnvelope<{ recoveryCodes: string[] }>>('/auth/2fa/recovery-codes', payload);
  return res.data.data;
}
