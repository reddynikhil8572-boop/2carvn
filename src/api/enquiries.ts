import { api } from './client';
import type { ApiEnvelope } from '@/types/api';

export type EnquiryStatus = 'NEW' | 'IN_PROGRESS' | 'CLOSED';

export interface PublicEnquiry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  organisation: string | null;
  kind: 'GENERAL' | 'DEMO';
  message: string;
  consentAt: string;
  status: EnquiryStatus;
  submittedAt: string;
  updatedAt: string;
}

export async function listEnquiries(): Promise<PublicEnquiry[]> {
  const response = await api.get<ApiEnvelope<PublicEnquiry[]>>('/admin/enquiries');
  return response.data.data;
}

export async function updateEnquiryStatus(id: string, status: EnquiryStatus): Promise<PublicEnquiry> {
  const response = await api.patch<ApiEnvelope<PublicEnquiry>>(`/admin/enquiries/${id}`, { status });
  return response.data.data;
}
