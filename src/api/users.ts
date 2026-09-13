import { api } from './client';

import type { UserSummary, CreateUserResponse, UserExport, ErasureReport } from '@/types/models';
import type { UserRole, ApiEnvelope } from '@/types/api';

/** School-admin user management — wraps backend-v2/src/routes/schoolAdmin.routes.ts. */

export interface CreateUserPayload {
  email: string;
  name: string;
  /** SUPER_ADMIN is rejected by the backend validator — never creatable here. */
  role: Exclude<UserRole, 'SUPER_ADMIN'>;
  password?: string;
}

export async function createUser(payload: CreateUserPayload): Promise<CreateUserResponse> {
  const res = await api.post<ApiEnvelope<CreateUserResponse>>('/school-admin/users', payload);
  return res.data.data;
}

export async function listUsers(): Promise<UserSummary[]> {
  const res = await api.get<ApiEnvelope<UserSummary[]>>('/school-admin/users');
  return res.data.data;
}

export async function exportUserData(userId: string): Promise<UserExport> {
  const res = await api.get<ApiEnvelope<UserExport>>(`/school-admin/users/${userId}/export`);
  return res.data.data;
}

export interface EraseUserPayload {
  /** Whether the user's certificates (if any) are revoked as part of the erasure. */
  revokeCertificates: boolean;
  /** Optional reason recorded in the audit log. */
  reason?: string;
}

/**
 * Erasure is a tombstone, not a delete. The backend refuses (409) to erase a
 * certificate holder until `revokeCertificates` is decided explicitly
 * (backend-v2/src/controllers/privacy.controller.ts).
 */
export async function eraseUserData(
  userId: string,
  payload: EraseUserPayload,
): Promise<ErasureReport> {
  const params = new URLSearchParams();
  params.set('revokeCertificates', String(payload.revokeCertificates));
  if (payload.reason) params.set('reason', payload.reason);
  const res = await api.delete<ApiEnvelope<ErasureReport>>(
    `/school-admin/users/${userId}?${params.toString()}`,
  );
  return res.data.data;
}
