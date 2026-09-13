import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import type { UserRole } from '@/types/api';

/** Merge Tailwind classes safely (deduplicates conflicting utilities). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Guard helpers — used in route guards and conditional UI. */
export const isSuperAdmin = (role: UserRole) => role === 'SUPER_ADMIN';
export const isSchoolAdmin = (role: UserRole) => role === 'SCHOOL_ADMIN';
export const isTeacher = (role: UserRole) => role === 'TEACHER';
export const isStudent = (role: UserRole) => role === 'STUDENT';
export const isStaff = (role: UserRole) =>
  role === 'SCHOOL_ADMIN' || role === 'TEACHER';

/** Short plural label for a role. */
export const roleLabel = (role: UserRole): string => {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Super Admin';
    case 'SCHOOL_ADMIN':
      return 'School Admin';
    case 'TEACHER':
      return 'Teacher';
    case 'STUDENT':
      return 'Student';
    case 'PARENT':
      return 'Parent';
  }
};
