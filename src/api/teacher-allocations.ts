import { api } from './client';
import type { ApiEnvelope } from '@/types/api';

export interface AllocationStudent {
  id: string;
  name: string;
  email: string;
}

export interface TeacherAllocation {
  id: string;
  schoolId: string;
  teacherId: string;
  classId: string;
  subject: string;
  section: string;
  weeklyHours: number;
  startsAt: string | null;
  endsAt: string | null;
  substituteForId: string | null;
  isActive: boolean;
  teacher?: { id: string; name: string; email: string };
  class: {
    id: string;
    name: string;
    academicYear: string;
    enrollments?: Array<{ student: AllocationStudent }>;
  };
  timetableSlots: TimetableSlot[];
  substituteFor?: { id: string; teacher: { id: string; name: string } } | null;
}

export interface TimetableSlot {
  id: string;
  allocationId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface TeacherAvailability {
  id: string;
  teacherId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface AllocationRequest {
  id: string;
  type: 'ASSIGN' | 'REPLACE' | 'REASSIGN';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  teacherId: string;
  classId: string;
  subject: string;
  section: string;
  weeklyHours: number;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
  decisionNote: string | null;
  targetAllocationId: string | null;
  requester: { id: string; name: string };
  reviewer?: { id: string; name: string } | null;
  teacher: { id: string; name: string };
  class: { id: string; name: string; academicYear: string };
}

export interface AllocationWarning {
  code: 'EXCESSIVE_WORKLOAD' | 'UNASSIGNED_CLASS' | 'UNSTAFFED_SUBJECT';
  message: string;
  entityId?: string;
}

export interface AllocationWorkspace {
  schoolId: string;
  teachers: Array<{ id: string; name: string; email: string }>;
  classes: Array<{ id: string; name: string; academicYear: string }>;
  allocations: TeacherAllocation[];
  requests: AllocationRequest[];
  availabilities: TeacherAvailability[];
  warnings: AllocationWarning[];
}

export interface MyAllocationWorkspace {
  allocations: TeacherAllocation[];
  availability: TeacherAvailability[];
}

export interface AllocationPayload {
  teacherId: string;
  classId: string;
  subject: string;
  section: string;
  weeklyHours: number;
  startsAt?: string | null;
  endsAt?: string | null;
  substituteForId?: string;
  replacesAllocationId?: string;
}

export interface AllocationRequestPayload extends AllocationPayload {
  type: 'ASSIGN' | 'REPLACE' | 'REASSIGN';
  targetAllocationId?: string;
  note?: string;
}

export interface AvailabilityWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface TimetablePayload {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export async function getAllocationWorkspace(schoolId: string): Promise<AllocationWorkspace> {
  const res = await api.get<ApiEnvelope<AllocationWorkspace>>('/admin/teacher-allocations', {
    params: { schoolId },
  });
  return res.data.data;
}

export async function getSchoolAllocationWorkspace(): Promise<AllocationWorkspace> {
  const res = await api.get<ApiEnvelope<AllocationWorkspace>>('/organiser/teacher-allocations');
  return res.data.data;
}

export async function getMyAllocations(): Promise<MyAllocationWorkspace> {
  const res = await api.get<ApiEnvelope<MyAllocationWorkspace>>('/teacher-allocations/me');
  return res.data.data;
}

export async function createAllocation(schoolId: string, payload: AllocationPayload): Promise<TeacherAllocation> {
  const res = await api.post<ApiEnvelope<TeacherAllocation>>(
    '/admin/teacher-allocations',
    payload,
    { params: { schoolId } },
  );
  return res.data.data;
}

export async function submitAllocationRequest(payload: AllocationRequestPayload): Promise<AllocationRequest> {
  const res = await api.post<ApiEnvelope<AllocationRequest>>('/organiser/teacher-allocation-requests', payload);
  return res.data.data;
}

export async function decideAllocationRequest(
  requestId: string,
  decision: 'APPROVED' | 'REJECTED',
): Promise<AllocationRequest> {
  const res = await api.post<ApiEnvelope<AllocationRequest>>(
    `/admin/teacher-allocation-requests/${requestId}/decision`,
    { decision },
  );
  return res.data.data;
}

export async function addTimetableSlot(
  schoolId: string,
  allocationId: string,
  payload: TimetablePayload,
): Promise<TimetableSlot> {
  const res = await api.post<ApiEnvelope<TimetableSlot>>(
    `/admin/teacher-allocations/${allocationId}/timetable`,
    payload,
    { params: { schoolId } },
  );
  return res.data.data;
}

export async function removeTimetableSlot(
  schoolId: string,
  allocationId: string,
  slotId: string,
): Promise<{ id: string }> {
  const res = await api.delete<ApiEnvelope<{ id: string }>>(
    `/admin/teacher-allocations/${allocationId}/timetable/${slotId}`,
    { params: { schoolId } },
  );
  return res.data.data;
}

export async function setTeacherAvailability(
  schoolId: string,
  teacherId: string,
  availability: AvailabilityWindow[],
): Promise<TeacherAvailability[]> {
  const res = await api.put<ApiEnvelope<TeacherAvailability[]>>(
    `/admin/teacher-allocations/teachers/${teacherId}/availability`,
    { availability },
    { params: { schoolId } },
  );
  return res.data.data;
}

export async function setMyAvailability(availability: AvailabilityWindow[]): Promise<TeacherAvailability[]> {
  const res = await api.put<ApiEnvelope<TeacherAvailability[]>>(
    '/teacher-allocations/me/availability',
    { availability },
  );
  return res.data.data;
}
