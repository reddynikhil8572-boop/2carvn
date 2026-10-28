import { api } from './client';
import type { ApiEnvelope, UserStatus } from '@/types/api';

export interface DivisionSummary {
  id: string;
  code: string;
  name: string;
  region: string | null;
  schools: Array<{
    id: string;
    name: string;
    schoolCode: string;
    city: string | null;
    isActive: boolean;
  }>;
  coordinators: Array<{
    id: string;
    createdAt: string;
    revokedAt: string | null;
    coordinator: { id: string; name: string; email: string; status: UserStatus };
    assignedBy: { id: string; name: string };
    revokedBy: { id: string; name: string } | null;
  }>;
}

export interface CoordinatorAccount {
  id: string;
  schoolId: string | null;
  name: string;
  email: string;
  status: UserStatus;
  school: { name: string; schoolCode: string } | null;
}

export async function listDivisions(): Promise<DivisionSummary[]> {
  const response = await api.get<ApiEnvelope<DivisionSummary[]>>('/admin/divisions');
  return response.data.data;
}

export async function listCoordinators(): Promise<CoordinatorAccount[]> {
  const response = await api.get<ApiEnvelope<CoordinatorAccount[]>>('/admin/coordinators');
  return response.data.data;
}

export async function createDivision(payload: { code: string; name: string; region?: string }) {
  const response = await api.post<ApiEnvelope<DivisionSummary>>('/admin/divisions', payload);
  return response.data.data;
}

export async function createCoordinator(payload: { schoolId: string; email: string; name: string }) {
  const response = await api.post<ApiEnvelope<CoordinatorAccount>>('/admin/coordinators', payload);
  return response.data.data;
}

export async function grantCoordinatorDivision(divisionId: string, coordinatorId: string) {
  const response = await api.post<ApiEnvelope<unknown>>(
    `/admin/divisions/${divisionId}/coordinators`,
    { coordinatorId },
  );
  return response.data.data;
}

export async function revokeCoordinatorDivision(divisionId: string, coordinatorId: string) {
  const response = await api.delete<ApiEnvelope<unknown>>(
    `/admin/divisions/${divisionId}/coordinators/${coordinatorId}`,
  );
  return response.data.data;
}

export async function setSchoolDivision(schoolId: string, divisionId: string | null) {
  const response = await api.patch<ApiEnvelope<{ id: string; divisionId: string | null }>>(
    `/admin/schools/${schoolId}/division`,
    { divisionId },
  );
  return response.data.data;
}
