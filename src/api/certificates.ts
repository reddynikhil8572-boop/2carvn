import { api } from './client';

import type { Certificate, CertificateVerification } from '@/types/models';
import type { ApiEnvelope } from '@/types/api';

/** Certificates — wraps backend-v2 routes (issue/list on the course router, revoke on the admin router, public verify/download). */

// ── Issuing & management (staff) ───────────────────────────────────────────

export async function issueCertificate(courseId: string, studentId: string): Promise<Certificate> {
  const res = await api.post<ApiEnvelope<Certificate>>(`/courses/${courseId}/certificates`, { studentId });
  return res.data.data;
}

export async function listCertificates(courseId: string): Promise<Certificate[]> {
  const res = await api.get<ApiEnvelope<Certificate[]>>(`/courses/${courseId}/certificates`);
  return res.data.data;
}

export async function revokeCertificate(serial: string, reason?: string): Promise<Certificate> {
  const res = await api.post<ApiEnvelope<Certificate>>(`/certificates/${serial}/revoke`, { reason });
  return res.data.data;
}

// ── Public verification (no auth, backend uses a SECURITY DEFINER) ─────────

export async function verifyCertificate(serial: string): Promise<CertificateVerification> {
  const res = await api.get<ApiEnvelope<CertificateVerification>>(
    `/certificates/${encodeURIComponent(serial)}`,
  );
  return res.data.data;
}

/**
 * Download URL for a certificate's PDF. The backend serves it directly; the
 * browser navigates here with cookies attached automatically.
 */
export function certificateDownloadUrl(serial: string): string {
  const base = api.defaults.baseURL ?? '';
  return `${base}/certificates/${encodeURIComponent(serial)}/download`;
}