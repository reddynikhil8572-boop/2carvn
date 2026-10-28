import { api } from './client';

import type { School, CreateSchoolResponse } from '@/types/models';
import type { Plan, ApiEnvelope } from '@/types/api';

/** Admin school management. */

export interface CreateSchoolPayload {
  schoolCode: string;
  name: string;
  city?: string;
  plan?: Plan;
  primaryColor?: string;
  customDomain?: string;
  admin: {
    email: string;
    name: string;
    password?: string;
  };
}

export async function createSchool(payload: CreateSchoolPayload): Promise<CreateSchoolResponse> {
  const res = await api.post<ApiEnvelope<CreateSchoolResponse>>('/admin/schools', payload);
  return res.data.data;
}

export async function listSchools(): Promise<School[]> {
  const res = await api.get<ApiEnvelope<School[]>>('/admin/schools');
  return res.data.data;
}
