import { api } from './client';
import type { ApiEnvelope, UserStatus } from '@/types/api';

export interface CoordinatorSchoolSummary {
  id: string;
  name: string;
  schoolCode: string;
  city: string | null;
  isActive: boolean;
  studentCounts: {
    total: number;
    active: number;
    inactive: number;
    suspended: number;
  };
  classes: Array<{
    id: string;
    name: string;
    academicYear: string;
    studentCount: number;
  }>;
}

export interface CoordinatorWorkspace {
  divisions: Array<{
    id: string;
    code: string;
    name: string;
    region: string | null;
    schools: CoordinatorSchoolSummary[];
  }>;
}

export async function getCoordinatorWorkspace(): Promise<CoordinatorWorkspace> {
  const response = await api.get<ApiEnvelope<CoordinatorWorkspace>>('/coordinator/divisions');
  return response.data.data;
}

export type CoordinatorStudentStatus = UserStatus;
